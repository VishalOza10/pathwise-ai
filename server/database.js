import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

export function createDatabase(path = ':memory:', password = process.env.DEMO_PASSWORD || 'Pathwise-Demo-Only-2026!', seedData = true) {
  if (password.length < 16 || password.length > 128) throw new Error('Demo password must contain 16–128 characters');
  const db = new DatabaseSync(path instanceof URL ? fileURLToPath(path) : path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS demo_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','advisor')), password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      advisor_id INTEGER NOT NULL REFERENCES users(id), program TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS student_roles_insert BEFORE INSERT ON students BEGIN
      SELECT CASE WHEN (SELECT role FROM users WHERE id=NEW.user_id) != 'student'
        OR (SELECT role FROM users WHERE id=NEW.advisor_id) != 'advisor' THEN RAISE(ABORT,'Invalid relationship') END;
    END;
    CREATE TRIGGER IF NOT EXISTS student_roles_update BEFORE UPDATE ON students BEGIN
      SELECT CASE WHEN (SELECT role FROM users WHERE id=NEW.user_id) != 'student'
        OR (SELECT role FROM users WHERE id=NEW.advisor_id) != 'advisor' THEN RAISE(ABORT,'Invalid relationship') END;
    END;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
      code TEXT NOT NULL, title TEXT NOT NULL, credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 6),
      UNIQUE(id,student_id)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, course_id INTEGER NOT NULL,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), due_at TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), completed_at TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0), UNIQUE(id,student_id),
      FOREIGN KEY(course_id,student_id) REFERENCES courses(id,student_id),
      CHECK((completed=0 AND completed_at IS NULL) OR (completed=1 AND completed_at IS NOT NULL)),
      CHECK(julianday(due_at) IS NOT NULL),
      CHECK(completed_at IS NULL OR julianday(completed_at) IS NOT NULL)
    );
    CREATE TRIGGER IF NOT EXISTS completion_time BEFORE UPDATE OF completed_at ON assignments
      WHEN NEW.completed_at IS NOT NULL AND julianday(NEW.completed_at) > julianday('now','+1 minute')
      BEGIN SELECT RAISE(ABORT,'Invalid completion date'); END;
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, course_id INTEGER NOT NULL,
      label TEXT NOT NULL, score REAL NOT NULL CHECK(score BETWEEN 0 AND 100),
      observed_at TEXT NOT NULL CHECK(julianday(observed_at) IS NOT NULL),
      FOREIGN KEY(course_id,student_id) REFERENCES courses(id,student_id)
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
      title TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new','reviewed','resolved')), version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0)
    );
    CREATE TRIGGER IF NOT EXISTS alert_transition BEFORE UPDATE OF status ON alerts
      WHEN NOT ((OLD.status='new' AND NEW.status='reviewed') OR (OLD.status='reviewed' AND NEW.status='resolved'))
      BEGIN SELECT RAISE(ABORT,'Invalid transition'); END;
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
      visibility TEXT NOT NULL CHECK(visibility IN ('student','advisor'))
    );
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
      title TEXT NOT NULL, description TEXT NOT NULL, link_key TEXT NOT NULL CHECK(link_key IN ('study','writing','learning'))
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, alert_id INTEGER NOT NULL REFERENCES alerts(id),
      actor_id INTEGER REFERENCES users(id), previous_status TEXT, new_status TEXT NOT NULL,
      event TEXT NOT NULL CHECK(event IN ('created','status_changed')), occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      owner_id INTEGER NOT NULL REFERENCES users(id),
      student_id INTEGER NOT NULL REFERENCES students(id),
      version INTEGER NOT NULL CHECK(version > 0),
      body TEXT NOT NULL CHECK(json_valid(body) AND length(body) <= 45000),
      PRIMARY KEY(owner_id,student_id)
    );
    CREATE TABLE IF NOT EXISTS plan_activity (
      id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
      student_id INTEGER NOT NULL REFERENCES students(id), version INTEGER NOT NULL,
      event TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('form','assistant','undo')),
      before_body TEXT, after_body TEXT NOT NULL, occurred_at TEXT NOT NULL,
      UNIQUE(owner_id,student_id,version)
    );
  `);
  if (seedData) {
    if (!db.prepare('SELECT id FROM users LIMIT 1').get()) seed(db, password);
    extendDemoRoster(db, password);
  }
  return db;
}

// One-time additive seed migration: preserve existing completion, alerts, and audit history.
function extendDemoRoster(db, password) {
  db.exec('CREATE TABLE IF NOT EXISTS demo_migrations (name TEXT PRIMARY KEY)');
  if (db.prepare('SELECT name FROM demo_migrations WHERE name=?').get('five-student-roster')) return;
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const user = db.prepare('INSERT INTO users VALUES (?,?,?,?,?)');
    user.run(6,'riley@pathwise.example','Riley Demo','student',hashPassword(password));
    user.run(7,'avery@pathwise.example','Avery Demo','student',hashPassword(password));
    const student = db.prepare('INSERT INTO students VALUES (?,?,?,?)');
    student.run(4,6,3,'B.S. Data Science');
    student.run(5,7,3,'B.S. Information Systems');
    const course = db.prepare('INSERT INTO courses VALUES (?,?,?,?,?)');
    course.run(5,4,'DS 250','Applied Statistics',3);
    course.run(6,5,'IS 230','Database Systems',3);
    const assignment = db.prepare('INSERT INTO assignments(id,student_id,course_id,title,due_at) VALUES (?,?,?,?,?)');
    assignment.run(8,4,5,'Sampling methods reflection',day(3));
    assignment.run(9,5,6,'Relational schema exercise',day(4));
    const grade = db.prepare('INSERT INTO grades VALUES (?,?,?,?,?,?)');
    grade.run(8,4,5,'Earlier recorded assessment',82,day(-18));
    grade.run(9,4,5,'Latest recorded assessment',88,day(-4));
    grade.run(10,5,6,'Latest recorded assessment',87,day(-5));
    db.prepare('INSERT INTO resources VALUES (?,?,?,?,?)').run(4,4,'Learning strategies','Explore practical approaches to learning.','learning');
    db.prepare('INSERT INTO resources VALUES (?,?,?,?,?)').run(5,5,'Build a weekly study plan','Break upcoming work into manageable study blocks.','study');
    db.prepare('INSERT INTO demo_migrations(name) VALUES (?)').run('five-student-roster');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function seed(db, password) {
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const user = db.prepare('INSERT INTO users VALUES (?,?,?,?,?)');
    for (const [id, email, name, role] of [
      [1,'student@pathwise.example','Alex Demo','student'],
      [2,'jordan@pathwise.example','Jordan Demo','student'],
      [3,'advisor@pathwise.example','Morgan Demo','advisor'],
      [4,'sam@pathwise.example','Sam Demo','student'],
      [5,'advisor2@pathwise.example','Casey Demo','advisor'],
    ]) user.run(id,email,name,role,hashPassword(password));
    db.prepare('INSERT INTO students VALUES (?,?,?,?)').run(1,1,3,'B.S. Computer Science');
    db.prepare('INSERT INTO students VALUES (?,?,?,?)').run(2,2,3,'B.S. Information Systems');
    db.prepare('INSERT INTO students VALUES (?,?,?,?)').run(3,4,5,'B.S. Computer Science');
    const course = db.prepare('INSERT INTO courses VALUES (?,?,?,?,?)');
    course.run(1,1,'CS 310','Cloud Computing',3);
    course.run(2,1,'CS 240','Data Structures',4);
    course.run(3,1,'MATH 220','Discrete Mathematics',3);
    course.run(4,2,'IS 210','Systems Analysis',3);
    const assignment = db.prepare('INSERT INTO assignments (id,student_id,course_id,title,due_at,completed,completed_at) VALUES (?,?,?,?,?,?,?)');
    for (const [id,student,courseId,title,due,done] of [
      [1,1,1,'Architecture reflection',-2,0], [2,1,2,'Binary search tree lab',-1,0],
      [3,1,1,'Deploy a container service',2,0], [4,1,3,'Graph theory problem set',3,0],
      [5,1,2,'Algorithm analysis quiz',5,0], [6,1,3,'Logic practice journal',-4,1],
      [7,2,4,'Requirements discovery',1,0],
    ]) assignment.run(id,student,courseId,title,day(due),done,done ? day(-5) : null);
    const grade = db.prepare('INSERT INTO grades VALUES (?,?,?,?,?,?)');
    grade.run(1,1,1,'Earlier recorded assessment',86,day(-21));
    grade.run(2,1,1,'Latest recorded assessment',78,day(-7));
    grade.run(3,1,2,'Earlier recorded assessment',88,day(-20));
    grade.run(4,1,2,'Latest recorded assessment',91,day(-6));
    grade.run(5,1,3,'Earlier recorded assessment',90,day(-20));
    grade.run(6,1,3,'Latest recorded assessment',92,day(-6));
    grade.run(7,2,4,'Latest recorded assessment',84,day(-6));
    db.prepare('INSERT INTO alerts(id,student_id,title,detail) VALUES (?,?,?,?)').run(1,1,'A workload check-in could help','Two seeded assignments need attention. Review the current support indicators before following up.');
    db.prepare('INSERT INTO alerts(id,student_id,title,detail) VALUES (?,?,?,?)').run(2,2,'Upcoming project milestone','Review the requirements discovery deadline together.');
    db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(1,1,'Bring your upcoming workload to your next advisor check-in.','student');
    db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(2,1,'Demo advisor note: review the assessment trend with the student.','advisor');
    db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(3,2,'Discuss project planning.','student');
    const resource = db.prepare('INSERT INTO resources VALUES (?,?,?,?,?)');
    resource.run(1,1,'Build a weekly study plan','Turn deadlines into small, realistic study blocks.','study');
    resource.run(2,1,'Writing support','A public guide to planning and revising academic writing.','writing');
    resource.run(3,2,'Learning strategies','Explore practical approaches to learning.','learning');
    const audit = db.prepare("INSERT INTO audit(alert_id,actor_id,previous_status,new_status,event,occurred_at) VALUES (?,NULL,NULL,'new','created',?)");
    audit.run(1,day(-2)); audit.run(2,day(-1));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

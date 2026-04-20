
-- USERS
CREATE TYPE user_role AS ENUM ('student', 'official', 'admin');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    school_id INT,
    role user_role DEFAULT 'student',

    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- SCHOOLS
CREATE TABLE schools (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT UNIQUE
);

ALTER TABLE users
ADD CONSTRAINT fk_user_school
FOREIGN KEY (school_id) REFERENCES schools(id);

-- VERIFICATIONS
CREATE TABLE verifications (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    method TEXT,
    status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- COMMUNITIES
CREATE TABLE communities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    creator_id INT REFERENCES users(id),

    is_private BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE community_members (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    community_id INT REFERENCES communities(id) ON DELETE CASCADE,

    role TEXT DEFAULT 'member',
    PRIMARY KEY (user_id, community_id)
);

-- COURSES
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    school_id INT REFERENCES schools(id),
    name TEXT NOT NULL,
    description TEXT,
    created_by INT REFERENCES users(id)
);

CREATE TABLE course_enrollments (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,

    role TEXT DEFAULT 'student',
    PRIMARY KEY (user_id, course_id)
);

-- POSTS
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    author_id INT REFERENCES users(id),
    content TEXT NOT NULL,

    is_official BOOLEAN DEFAULT FALSE,

    community_id INT,
    course_id INT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);

ALTER TABLE posts
ADD CONSTRAINT fk_post_community
FOREIGN KEY (community_id) REFERENCES communities(id);

ALTER TABLE posts
ADD CONSTRAINT fk_post_course
FOREIGN KEY (course_id) REFERENCES courses(id);

-- COMMENTS (REPLIES SUPPORTED)
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    post_id INT REFERENCES posts(id) ON DELETE CASCADE,
    author_id INT REFERENCES users(id),
    parent_id INT REFERENCES comments(id),

    content TEXT NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- REACTIONS (ONE PER USER)
CREATE TABLE reactions (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    post_id INT REFERENCES posts(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('like', 'heart', 'smile')),

    PRIMARY KEY (user_id, post_id)
);

-- FOLLOW SYSTEM
CREATE TABLE followers (
    follower_id INT REFERENCES users(id) ON DELETE CASCADE,
    following_id INT REFERENCES users(id) ON DELETE CASCADE,

    PRIMARY KEY (follower_id, following_id),

    CHECK (follower_id != following_id)
);

-- REPORTS (POSTS OR COMMENTS)
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id INT REFERENCES users(id),

    post_id INT REFERENCES posts(id),
    comment_id INT REFERENCES comments(id),

    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',

    admin_note TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE reports
ADD CONSTRAINT check_report_target
CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL)
    OR
    (post_id IS NULL AND comment_id IS NOT NULL)
);

-- NOTIFICATIONS
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),

    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PASSWORD RESET
CREATE TABLE password_resets (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,

    token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

-- ADMIN ACTION LOG
CREATE TABLE admin_actions (
    id SERIAL PRIMARY KEY,

    admin_id INT REFERENCES users(id),

    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id INT,

    description TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- USER PENALTIES
CREATE TABLE user_penalties (
    id SERIAL PRIMARY KEY,

    user_id INT REFERENCES users(id),
    issued_by INT REFERENCES users(id),

    reason TEXT,
    expires_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- LOGIN LOGS
CREATE TABLE login_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    success BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- USER LOGGING
CREATE TABLE user_activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),

    action_type TEXT,
    target_type TEXT,
    target_id INT,

    metadata JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES (might not be needed if queries are quick enough)
--CREATE INDEX idx_posts_author ON posts(author_id);
--CREATE INDEX idx_comments_post ON comments(post_id);
--CREATE INDEX idx_reports_status ON reports(status);

-- UniConnect schema aligned to db.json

CREATE TYPE user_role AS ENUM ('student', 'official', 'admin');

-- SCHOOLS
CREATE TABLE schools (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT UNIQUE
);

-- PROFILES
CREATE TABLE profiles (
    id UUID PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT NOT NULL,
    school_id INT REFERENCES schools(id),
    role user_role DEFAULT 'student',
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- VERIFICATIONS
CREATE TABLE verifications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    method TEXT,
    status TEXT DEFAULT 'pending',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- COMMUNITIES
CREATE TABLE communities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    creator_id UUID REFERENCES profiles(id),
    is_private BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE community_members (
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
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
    created_by UUID REFERENCES profiles(id)
);

CREATE TABLE course_enrollments (
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'student',
    PRIMARY KEY (user_id, course_id)
);

-- POSTS
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    author_id UUID REFERENCES profiles(id),
    content TEXT NOT NULL,
    is_official BOOLEAN DEFAULT FALSE,
    community_id INT REFERENCES communities(id),
    course_id INT REFERENCES courses(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- COMMENTS
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    post_id INT REFERENCES posts(id) ON DELETE CASCADE,
    author_id UUID REFERENCES profiles(id),
    parent_id INT REFERENCES comments(id),
    content TEXT NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- REACTIONS
CREATE TABLE reactions (
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    post_id INT REFERENCES posts(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('like', 'heart', 'smile')),
    PRIMARY KEY (user_id, post_id)
);

-- FOLLOW SYSTEM
CREATE TABLE followers (
    follower_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id != following_id)
);

-- POST REPORTS
CREATE TABLE post_reports (
    id SERIAL PRIMARY KEY,
    reporter_id UUID REFERENCES profiles(id),
    post_id INT REFERENCES posts(id),
    comment_id INT REFERENCES comments(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_report_target CHECK (
        (post_id IS NOT NULL AND comment_id IS NULL)
        OR
        (post_id IS NULL AND comment_id IS NOT NULL)
    )
);

-- USER REPORTS
CREATE TABLE user_reports (
    id SERIAL PRIMARY KEY,
    reporter_id UUID REFERENCES profiles(id),
    reported_user_id UUID REFERENCES profiles(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_user_report_target CHECK (
        reporter_id IS DISTINCT FROM reported_user_id
    )
);

-- COMMUNITY REPORTS
CREATE TABLE community_reports (
    id SERIAL PRIMARY KEY,
    reporter_id UUID REFERENCES profiles(id),
    community_id INT REFERENCES communities(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NOTIFICATIONS
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ADMIN ACTION LOG
CREATE TABLE admin_actions (
    id SERIAL PRIMARY KEY,
    admin_id UUID REFERENCES profiles(id),
    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id INT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- USER PENALTIES
CREATE TABLE user_penalties (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    issued_by UUID REFERENCES profiles(id),
    reason TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LOGIN LOGS
CREATE TABLE login_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    success BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- USER ACTIVITY LOGGING
CREATE TABLE user_activity_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    action_type TEXT,
    target_type TEXT,
    target_id INT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES (optional)
-- CREATE INDEX idx_posts_author ON posts(author_id);
-- CREATE INDEX idx_comments_post ON comments(post_id);
-- CREATE INDEX idx_post_reports_status ON post_reports(status);
-- CREATE INDEX idx_user_reports_status ON user_reports(status);
-- CREATE INDEX idx_community_reports_status ON community_reports(status);

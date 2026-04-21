var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
require('dotenv').config();

var indexRouter = require('./routes/index');
var authRouter = require('./routes/auth');
var dashboardRouter = require('./routes/dashboard');
var feedRouter = require('./routes/feed');
var communityRouter = require('./routes/community');
var communityDetailRouter = require('./routes/community-detail');
var adminRouter = require('./routes/admin');
var moderationRouter = require('./routes/moderation');
var postsRouter = require('./routes/posts');
var profileRouter = require('./routes/profile');
var settingsRouter = require('./routes/settings');
var coursesRouter = require('./routes/courses');
var createCommunityRouter = require('./routes/create-community');
var storageRouter = require('./routes/storage');
const { attachSessionUser } = require('./middleware/auth');

var app = express();

// view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// session FIRST
app.use(session({
  secret: process.env.SESSION_SECRET || 'uniconnect-secret',
  resave: false,
  saveUninitialized: false
}));

app.use(attachSessionUser);

// routes
app.use('/', indexRouter);
app.use('/', authRouter);
app.use('/dashboard', dashboardRouter);
app.use('/feed', feedRouter);
app.use('/communities', communityRouter);
app.use('/communities', communityDetailRouter);
app.use('/admin', adminRouter);
app.use('/moderation', moderationRouter);
app.use('/posts', postsRouter);
app.use('/post', postsRouter);
app.use('/profile', profileRouter);
app.use('/settings', settingsRouter);
app.use('/courses', coursesRouter);
app.use('/create-community', createCommunityRouter);
app.use('/storage', storageRouter);


// 404
app.use(function(req, res, next) {
  const err = new Error("Page Not Found");
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  res.status(err.status || 500);

  res.render('error', {
    message: err.message,
    error: req.app.get('env') === 'development' ? err : {}
  });
});

module.exports = app;

require("dotenv").config();
const { version } = require('./package.json');
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const passport = require("passport");
const bodyParser = require("body-parser");
const app = express();
const port = process.env.PORT || 8080;
let shuttingDown = false;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const pushRoutes = require("./src/routes/push.routes");
const notificationRoutes = require('./src/routes/notification.routes');
const fileAccessMiddleware = require('./src//middleware/fileAccessMiddleware');
const path = require("path");

require("./src/config/passport");
const { bigIntSerializer } = require("./src/utils/serializer");
const { subscriptionMiddleware } = require("./src/middleware/subscriptionMiddleware");
const auditLogMiddleware = require("./src/middleware/auditLog.middleware");
const db = require("./src/config/knex");

app.set("trust proxy", 1);
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(bigIntSerializer);
app.use(auditLogMiddleware);
const allowedOrigins = [
  "http://localhost:3005",
  "http://localhost:4173",
  ...(process.env.NGROK_URL ? [process.env.NGROK_URL] : []),
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',').map(o => o.trim()) : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: "GET,POST,PUT,DELETE,PATCH",
    credentials: true,
  })
);

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET env var is not set');
  process.exit(1);
}
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// --- Health checks (no auth, cheap) ---
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get("/health/ready", async (req, res) => {
  if (shuttingDown) return res.status(503).json({ status: "shutting-down" });
  try {
    await db.raw("SELECT 1");
    res.json({ status: "ready", db: "up" });
  } catch (err) {
    res.status(503).json({ status: "not-ready", db: "down", error: err.message });
  }
});


const authRoute = require("./src/routes/auth.routes");
const googleRoute = require("./src/routes/google.routes");
const apiCacheRoutes = require('./src/routes/cache.routes');
const staffPermissionRoutes = require('./src/routes/admin/staffPermissions.routes');
const systemPermissionRoutes = require('./src/routes/admin/systemSettings.routes');
const analyticsRoutes = require('./src/routes/analytics.route');
const houseRoutes = require('./src/routes/house.routes');
const financialRoutes = require('./src//routes/financial.routes');
const flatRoutes = require('./src/routes/flat.routes');
const authMiddleware = require("./src/middleware/auth.middleware");
const renterRoutes = require("./src/routes/renter.routes");
const caretakerRoutes = require("./src/routes/caretaker.routes");
const imageRoutes = require('./src/routes/image.routes');
const appFeesRoutes = require('./src/routes/appFees.routes');
const loanRoutes = require('./src/routes/loan.routes');
const { publicRouter: landingPublicRouter, adminRouter: landingAdminRouter } = require('./src/routes/landingPage.routes');
const landingPageService = require('./src/services/landingPage.service');


// app.use('/api/images', imageRoutes);

// Landing images are public — they appear on the unauthenticated landing page.
// Cross-Origin-Resource-Policy must be 'cross-origin' so <img> tags on other
// origins (dev: localhost:3005 vs :8080; prod: same domain, no-op) can load them.
app.use(
  "/uploads/landing",
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, "uploads", "landing"), {
    maxAge: '7d',
    immutable: false,
  })
);

// All other uploads require a valid JWT (must come after the public route above).
// Cache-Control: private prevents CDN/proxy caching while letting the browser
// cache the blob for 24 h — avoids a round-trip on every page reload.
app.use(
  "/uploads",
  authMiddleware,
  fileAccessMiddleware,
  (req, res, next) => {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);


app.use("/auth", googleRoute);
app.use("/auth", authRoute);
app.use(subscriptionMiddleware);
app.use("/push", pushRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/cache', apiCacheRoutes);
app.use('/admin/permissions', staffPermissionRoutes);
app.use('/admin/audit-logs', require('./src/routes/admin/auditLog.routes'));
app.use('/houses', houseRoutes);
app.use('/admin/system-settings', systemPermissionRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/', financialRoutes);
app.use('/', flatRoutes)
app.use('/', renterRoutes);
app.use('/caretakers', caretakerRoutes);
app.use('/house-owner-analytics', require('./src/routes/houseOwnerAnalytics.routes'));
app.use('/app-fees', appFeesRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/public', landingPublicRouter);
app.use('/admin/landing-config', landingAdminRouter);

// router.use('/user-management', userManagementRoutes);

app.get("/api/version", (req, res) => {
  res.json({ version, env: process.env.NODE_ENV || "development" });
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

// --- Global error handler (MUST be last) ---
// Express 5 forwards errors thrown in async handlers here, as do next(err) calls
// (CORS rejection at the origin callback, body-parser JSON syntax errors, multer
// errors). Centralizing this guarantees every error becomes a shaped response
// instead of leaking out of the request lifecycle.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    success: false,
    error: status >= 500 ? "Internal server error" : err.message,
  });
});


landingPageService.initialize();

const server = app.listen(port, () => console.log(`lISTENING TO PORT ${port}`));

// --- Unified graceful shutdown ---
// Single owner of process.exit(). The analytics services' own SIGTERM/SIGINT
// handlers no longer call process.exit (see analytics.service.js / houseOwnerAnalytics.service.js);
// they only run their idempotent shutdown(), which we also invoke here.
const audit = require('./src/services/audit.service');
const analyticsService = require('./src/services/analytics.service');
const houseOwnerAnalyticsService = require('./src/services/houseOwnerAnalytics.service');

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 15000;

// NOTE: no email drain step anymore — emails live in the durable `email_outbox`
// table the moment they are queued (see src/services/email.service.js), and a
// cPanel cron job (scripts/process-email-queue.js) delivers them. Restarts can
// no longer lose queued mail, so shutdown has nothing email-related to wait for.

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining...`);

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] timeout exceeded — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  if (forceTimer.unref) forceTimer.unref();

  // 1. Stop accepting new connections; wait for in-flight requests.
  await new Promise((resolve) =>
    server.close((err) => {
      if (err) console.error('[shutdown] server.close error:', err.message);
      resolve();
    })
  );
  console.log('[shutdown] HTTP server closed');

  // 2. Flush buffered audit rows.
  try { await audit.shutdown(); } catch (e) { console.error('[shutdown] audit:', e.message); }

  // 3. Terminate worker pools (analytics only — email is cron-drained now).
  await Promise.allSettled([
    analyticsService.shutdown(),
    houseOwnerAnalyticsService.shutdown(),
  ]);
  console.log('[shutdown] worker pools terminated');

  // 4. Destroy knex pool LAST (drain/flush steps may hit DB).
  try { await db.destroy(); console.log('[shutdown] knex pool destroyed'); }
  catch (e) { console.error('[shutdown] db.destroy error:', e.message); }

  clearTimeout(forceTimer);
  console.log('[shutdown] complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Process-level safety net ---
// Node crashes on an unhandled rejection by default (v15+), and an uncaught
// exception in a stray callback (worker message, stream 'error', timer) would
// otherwise terminate the whole app. Log and keep serving so one bad request
// can't take the site down. The known root causes (worker pool, multipart) are
// fixed at the source; this is the last-resort guard, not the primary defense.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
require("dotenv").config();
const { version } = require('./package.json');
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const passport = require("passport");
const bodyParser = require("body-parser");
const app = express();
const port = process.env.PORT || 8080;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const pushRoutes = require("./src/routes/push.routes");
const notificationRoutes = require('./src/routes/notification.routes');
const fileAccessMiddleware = require('./src//middleware/fileAccessMiddleware');
const path = require("path");

require("./src/config/passport");
const { bigIntSerializer } = require("./src/utils/serializer");
const { subscriptionMiddleware } = require("./src/middleware/subscriptionMiddleware");

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(bigIntSerializer);
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


landingPageService.initialize();

app.listen(port,()=> console.log(`lISTENING TO PORT ${port}`))
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const bodyParser = require("body-parser");
const app = express();
const port = process.env.PORT || 8080;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const pushRoutes = require("./src/routes/push.routes");
const notificationRoutes = require('./src/routes/notification.routes');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

require("./src/config/passport");
const { bigIntSerializer } = require("./src/utils/serializer");

app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(bigIntSerializer);
app.use(
  cors({
    origin: ["http://localhost:3005", '**.ngrok-free.app'],
    methods: "GET,POST,PUT,DELETE,PATCH",
    credentials: true, 
  })
);

app.use(
  session({
    secret: "bariporichaloona",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session()); 

const authRoute = require("./src/routes/auth.routes");
const googleRoute = require("./src/routes/google.routes");
const apiCacheRoutes = require('./src/routes/cache.routes');
const staffPermissionRoutes = require('./src/routes/admin/staffPermissions.routes');
const houseRoutes = require('./src/routes/house.routes');
const systemPermissionRoutes = require('./src/routes/admin/systemSettings.routes');
const analyticsRoutes = require('./src/routes/analytics.route');


app.use("/auth", googleRoute);
app.use("/auth", authRoute);
app.use("/push", pushRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/cache', apiCacheRoutes);
app.use('/admin/permissions', staffPermissionRoutes);
app.use('/houses', houseRoutes);
app.use('/admin/system-settings', systemPermissionRoutes);
app.use('/analytics', analyticsRoutes);

//write a running status endpoint at '/'
app.get("/", (req, res) => {
  res.send("Server is running");
});


app.listen(port,()=> console.log(`lISTENING TO PORT ${port}`))
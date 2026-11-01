// pm2 start deploy/ecosystem.config.js  (dalla cartella dell'app)
module.exports = {
  apps: [{
    name: "blucheck",
    script: "server.js",
    cwd: __dirname + "/..",
    instances: 1,            // SQLite: una sola istanza
    exec_mode: "fork",
    max_memory_restart: "300M",
    env: { NODE_ENV: "production", TZ: "Europe/Rome" },
  }],
};

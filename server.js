var echo = require('./dist/index.js');

const options = {
    "authHost": "http://localhost",
    "authEndpoint": "/socket/auth",
    "clients": [
    ],
    "database": "redis",
    "databaseConfig": {
        "redis": {
            "port": "6379",
            "host": "localhost",
            "password": null,
            "database": 0,
            "keyPrefix": ""
        },
        "sqlite": {
            "databasePath": "/database/laravel-echo-server.sqlite"
        }
    },
    "devMode": true,
    "host": "localhost",
    "port": "6003",
    "protocol": "http",
    "socketio": {
        "cors": {
            "origin": "*",
            "methods": ["GET", "POST"],
            "allowedHeaders": ["Origin", "Content-Type", "X-Auth-Token", "X-Requested-With", "Accept", "Authorization", "X-CSRF-TOKEN", "X-Socket-Id"],
            "credentials": true
        }
    },
    "secureOptions": 67108864,
    "sslCertPath": "",
    "sslKeyPath": "",
    "sslCertChainPath": "",
    "sslPassphrase": "",
    "subscribers": {
        "http": false,
        "redis": true
    },
    apiOriginAllow: {
        allowCors: true,
        allowOrigin: "*",
        allowMethods: "GET, PUT, POST, DELETE, HEAD, OPTIONS",
        allowHeaders: "Origin, Content-Type, X-Auth-Token, X-Requested-With, Accept, Authorization, X-CSRF-TOKEN, X-Socket-Id"
    },
    allowCreationOfPrivateChannels: true
  };
echo.run(options);
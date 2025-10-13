require('dotenv').config();

module.exports = {
	dbHost: process.env.DB_HOST || 'localhost',
	dbPort: parseInt(process.env.DB_PORT) || 3306,
	dbName: process.env.DB_NAME || 'e_hentai_db',
	dbUser: process.env.DB_USER || 'root',
	dbPass: process.env.DB_PASS || '',
	port: parseInt(process.env.PORT) || 8880,
	cors: process.env.CORS === 'true' || false,
	corsOrigin: process.env.CORS_ORIGIN || '*',
	webui: process.env.WEBUI === 'true' || false,
	webuiPath: process.env.WEBUI_PATH || 'dist',
};
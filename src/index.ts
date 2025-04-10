import express from 'express';
import apiRouter from './routes/Api.js';
import config from './config/index.js';
import authMiddleware from './middleware/Auth.js';

const app = express();
app.use(authMiddleware);
app.use(apiRouter);

app.listen(config.PORT, () => {
	console.log(`Server running on http://localhost:${config.PORT}`);
});

import express from 'express';
import apiRouter from './routes/Api';
import config from './config';
import authMiddleware from './middleware/Auth';

const app = express();
app.use(authMiddleware);
app.use(apiRouter);

app.listen(config.PORT, () => {
	console.log(`Server running on http://localhost:${config.PORT}`);
});

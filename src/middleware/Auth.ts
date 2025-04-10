import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
	const token = req.query.token as string;
	try {
		jwt.verify(token, config.AUTH_CODE);
		next();
	} catch (error) {
		res.status(401).json({ error: 'Unauthorized' });
	}
};

export default authMiddleware;

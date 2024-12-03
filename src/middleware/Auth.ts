import { Request, Response, NextFunction } from 'express';
import config from '../config';

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
	const { code } = req.query;
	if (code === config.AUTH_CODE) next();
	else res.status(403).send();
};

export default authMiddleware;

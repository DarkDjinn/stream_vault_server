import express, { Request, Response } from 'express';
import fs from 'fs';
import { MovieService } from '../services/MovieService';
import path from 'path';
import config from '../config';

const router = express.Router();
const movieService = new MovieService();

router.get('/api/movies', (req: Request, res: Response): void => {
	const movieList = Object.keys(movieService.movieCache).map(
		movieId => movieService.movieCache[movieId]
	);
	res.json(movieList);
});

router.get('/api/subtitles/:id', async (req: Request, res: Response): Promise<void> => {
	const { id } = req.params;
	res.json(
		movieService.subtitleCache[id].map(sub => ({
			...sub,
			url: `${sub.url}&token=${req.query.token}`,
		}))
	);
});

router.get('/api/subtitle-file', (req: Request, res: Response) => {
	const filePath = decodeURIComponent(req.query.path as string);

	if (config.ENV === 'dev') {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	}

	if (!filePath || !fs.existsSync(filePath)) {
		console.warn(`Subtitle file not found: ${filePath}`);
		res.status(404).json({ error: 'Subtitle file not found' });
		return;
	}

	const validExtensions = ['.srt', '.vtt'];
	const ext = path.extname(filePath).toLowerCase();
	if (!validExtensions.includes(ext)) {
		console.warn(`Invalid subtitle file type: ${filePath}`);
		res.status(400).json({ error: 'Invalid subtitle file type' });
		return;
	}

	const contentType = ext === '.srt' ? 'text/srt' : 'text/vtt';

	res.setHeader('Content-Type', contentType);
	res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);

	const fileStream = fs.createReadStream(filePath);
	fileStream.pipe(res);
});

router.get('/api/stream/:id', (req: Request, res: Response): void => {
	const { id } = req.params;
	const movie = movieService.movieCache[id];

	if (!movie) {
		console.warn(`Stream API Route - Movie Not Found: ${id}`);
		res.status(404).json({ error: 'Movie not found' });
		return;
	}

	const stat = fs.statSync(movie.filePath);
	const fileSize = stat.size;
	const range = req.headers.range;

	if (range) {
		const parts = range.replace(/bytes=/, '').split('-');
		const start = parseInt(parts[0], 10);
		const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

		if (start >= fileSize || end >= fileSize) {
			res.status(416).send('Requested range not satisfiable\n');
			return;
		}

		const chunkSize = end - start + 1;
		const file = fs.createReadStream(movie.filePath, { start, end });
		const head = {
			'Content-Range': `bytes ${start}-${end}/${fileSize}`,
			'Accept-Ranges': 'bytes',
			'Content-Length': chunkSize,
			'Content-Type': 'video/mp4',
		};

		res.writeHead(206, head);
		file.pipe(res);
	} else {
		const head = {
			'Content-Length': fileSize,
			'Content-Type': 'video/mp4',
		};

		res.writeHead(200, head);
		fs.createReadStream(movie.filePath).pipe(res);
	}
});

export default router;

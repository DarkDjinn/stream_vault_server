import fs from 'fs';
import path from 'path';
import { MovieMeta, Subtitle, SubtitleResponse, SubtitleURL } from '../interfaces';
import chokidar from 'chokidar';
import nameToImdb from 'name-to-imdb';
import axios from 'axios';
import * as unzipper from 'unzipper';
import config from '../config';

export class MovieService {
	supportedFormats = ['.mp4', '.webm', '.avi', '.mkv', '.mov', '.flv', '.wmv'];
	movieCache: { [x: string]: MovieMeta } = {};
	subtitleCache: {
		[x: string]: SubtitleURL[];
	} = {};
	movieFolder = path.join(__dirname, '..', '..', 'movies');

	constructor() {
		this.initializeMovies();
		const watcher = chokidar.watch(this.movieFolder, {
			persistent: true,
			ignoreInitial: true,
		});
		watcher.on('add', filePath => this.processNewMovie(filePath));
		watcher.on('unlink', filePath => {
			this.removeMovieFromCache(filePath);
		});
		watcher.on('change', filePath => {
			this.removeMovieFromCache(filePath);
			this.processNewMovie(filePath);
		});
	}

	private initializeMovies = () => {
		const walkDirectory = (dir: string) => {
			const files = fs.readdirSync(dir);

			for (let file of files) {
				const fullPath = path.join(dir, file);
				const stat = fs.statSync(fullPath);

				if (stat.isDirectory()) {
					walkDirectory(fullPath);
				} else if (stat.isFile()) {
					this.processNewMovie(fullPath);
				}
			}
		};

		walkDirectory(this.movieFolder);
	};

	private processNewMovie = (fullPath: string) => {
		const fileExt = path.extname(fullPath).toLowerCase();

		if (this.supportedFormats.includes(fileExt)) {
			const movieId = path.basename(fullPath, fileExt);
			if (!this.movieCache[movieId]) {
				const movieTitle = movieId
					.replace(
						/(\d{3,4}p|HDRip|BluRay|x264|x265|HEVC|WEBRip|WEB-DL|DVDRip|HQ|10bit|1080p|720p|[\[\]();-]+|\b(\d{4})\b|GalaxyRG|TGx|RARBG|YTS|CD\d*|Part\d*|[0-9]+(MB|GB|KB))+/gi,
						''
					)
					.replace(/[_.]/g, ' ')
					.trim()
					.replace(/\s+/g, ' ');
				this.fetchImdbData(movieTitle, movieId, fullPath);
			}
		}
	};

	removeMovieFromCache = (filePath: string) => {
		const movieId = Object.keys(this.movieCache).find(
			key => this.movieCache[key].filePath === filePath
		);
		movieId && delete this.movieCache[movieId];
	};

	fetchImdbData = (movieTitle: string, movieId: string, filePath: string) => {
		nameToImdb(movieTitle, async (err, imdbId, inf) => {
			if (err) {
				console.error(`Error fetching IMDB info for ${movieTitle}:`, err);
			} else if (imdbId) {
				await this.fetchMetaDataAndInsertToCache(imdbId, movieId, filePath);
			}
		});
	};

	fetchMetaDataAndInsertToCache = async (imdbId: string, movieId: string, filePath: string) => {
		let meta = {} as MovieMeta;
		for (let type of ['movie', 'series']) {
			const { data } = await axios.get(
				'https://v3-cinemeta.strem.io/meta/' + type + '/' + imdbId + '.json'
			);
			if (data && data.meta) {
				meta = data.meta;
				break;
			}
		}
		this.movieCache[movieId] = {
			...meta,
			behaviorHints: { ...meta.behaviorHints, defaultVideoId: movieId },
			id: movieId, // Local Id
			filePath,
		};

		if (!this.subtitleCache[movieId]) {
			await this.fetchSubtitles(movieId);
		}
	};

	fetchSubtitles = async (movieId: string) => {
		const outputDir = path.dirname(this.movieCache[movieId].filePath).replace('/movies/', '/subs/');
		if (!fs.existsSync(outputDir) || !fs.readdirSync(outputDir).length) {
			fs.mkdirSync(outputDir, { recursive: true });
			const imdbId = this.movieCache[movieId].imdb_id;
			const subtitles = [] as Subtitle[];
			let page = 1;
			let totalPages = 1;
			try {
				while (page <= totalPages) {
					const { data } = await axios.get<SubtitleResponse>(
						`https://api.subdl.com/api/v1/subtitles?api_key=${config.SUBDL_API_KEY}&imdb_id=${imdbId}&languages=en&subs_per_page=30&page=${page}`
					);
					totalPages = data.totalPages;
					subtitles.push(...data.subtitles);
					page++;
					if (!data.subtitles.length) {
						break;
					}
				}
				for (let sub of subtitles) {
					await this.saveSubtitles(`https://dl.subdl.com${sub.url}`, outputDir);
				}
			} catch (error) {
				console.error(`Error fetching subtitles for movie ${movieId}:`, error);
			}
		}
		this.subtitleCache[movieId] = this.getSubtitlesFromDir(outputDir);
	};

	saveSubtitles = async (url: string, outputDir: string) => {
		try {
			const response = await axios.get(url, {
				responseType: 'stream',
				timeout: 10000,
			});

			response.data
				.pipe(unzipper.Extract({ path: outputDir }))
				.on('error', (err: any) => console.error('Extraction error:', err.message));
		} catch (error: any) {
			console.error('Error downloading subtitle:', error.message);
		}
	};

	getSubtitlesFromDir = (dir: string) => {
		const files = fs.readdirSync(dir);

		const subtitleFiles = files.filter(file => {
			const ext = path.extname(file).toLowerCase();
			return ext === '.srt' || ext === '.vtt';
		});

		const filePaths = subtitleFiles.map(file => ({
			id: path.basename(file),
			lang: 'en',
			url: `${config.APP_URL}/api/subtitle-file?path=${encodeURIComponent(
				path.join(dir, file)
			)}&code=${config.AUTH_CODE}`,
		}));

		return filePaths;
	};
}

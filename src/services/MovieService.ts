import fs from 'fs';
import path from 'path';
import { MovieMeta, SubtitleURL } from '../interfaces/index.js';
import chokidar from 'chokidar';
import nameToImdb from 'name-to-imdb';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { WhisperService } from './WhisperService.js';
import { SubtitleService } from './SubtitleService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MovieService {
	supportedFormats = ['.mp4', '.webm', '.avi', '.mkv', '.mov', '.flv', '.wmv'];
	movieCache: { [x: string]: MovieMeta } = {};
	subtitleCache: {
		[x: string]: SubtitleURL[];
	} = {};
	movieFolder = path.join(__dirname, '..', '..', 'movies');
	private movieQueue: string[] = [];
	private isProcessing = false;

	constructor(private whisper: WhisperService, private subtitles: SubtitleService) {
		this.initializeMovies();

		const watcher = chokidar.watch(this.movieFolder, {
			persistent: true,
			ignoreInitial: true,
		});

		watcher.on('add', filePath => {
			if (typeof filePath === 'string') {
				this.enqueueMovie(filePath);
			}
		});

		watcher.on('unlink', filePath => {
			if (typeof filePath === 'string') this.removeMovieFromCache(filePath);
		});

		watcher.on('change', filePath => {
			if (typeof filePath === 'string') this.removeMovieFromCache(filePath);
			if (typeof filePath === 'string') this.enqueueMovie(filePath);
		});
	}

	private enqueueMovie(filePath: string) {
		this.movieQueue.push(filePath);
		this.processQueue();
	}

	private async processQueue() {
		if (this.isProcessing) return;
		this.isProcessing = true;

		while (this.movieQueue.length > 0) {
			const nextFile = this.movieQueue.shift();
			if (nextFile) {
				try {
					await this.processNewMovie(nextFile);
				} catch (err) {
					console.error(`Failed to process ${nextFile}:`, err);
				}
			}
		}

		this.isProcessing = false;
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
					this.enqueueMovie(fullPath);
				}
			}
		};
		walkDirectory(this.movieFolder);
	};

	cleanMovieName = (name: string) => {
		return (
			name
				// First remove obvious release tags
				.replace(/\[.*?\]/g, '')
				.replace(/\(.*?\)/g, '')

				// Remove date stamps (but not standalone years)
				.replace(/\b\d{4}\.\d{2}\.\d{2}\b/g, '')
				.replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, '')

				// Remove technical specifications and release groups
				// Order is important here - more specific patterns first
				.replace(/\bH\.?264\b/gi, '') // Handle H.264 specifically
				.replace(/\b(?:DD|AAC|DTS)?5\.1\b/gi, '') // Handle 5.1 audio specifically
				.replace(/\bAAC\d*\b/gi, '') // Handle AAC specifically
				.replace(/\bMVGroup\b/gi, '') // Remove MVGroup specifically

				// Handle broader technical specifications
				.replace(
					/\b(?:\d{3,4}[pi]|(?:480|720|1080|2160)[pi]|HDTV|HD|UHD|BRRip|BluRay|WEBRip|WEB-DL|DVDRip|DVDR|DVD|WEB|Blu-Ray)\b/gi,
					''
				)
				.replace(
					/\b(?:x264|x265|HEVC|XviD|DivX|MP4|AC3|DTS|DDP?5\.1|10bit)\b(?:\.[A-Za-z0-9]+)?/gi,
					''
				)
				.replace(/\b(?:REMASTERED|EXTENDED|UNRATED|PROPER|REPACK|IMAX)\b/gi, '')

				// Remove file size info
				.replace(/\b\d+(?:\.\d+)?(?:MB|GB|mb|gb)\b/gi, '')

				// Remove quality indicators
				.replace(/\b(?:HQ|HDR|SDR)\b/gi, '')

				// Remove common file extensions
				.replace(/\.\b(?:mkv|avi|mp4|mov|wmv|flv|webm|m4v|mpg|mpeg)\b/gi, '')

				// Remove domain suffixes
				.replace(/\.[a-z]{2,6}$/gi, '')

				// Remove release group signatures (must come after other cleanups)
				.replace(/-[A-Za-z0-9]+(?:\[.*?\])?$/g, '')

				// Clean up dots, spaces, and unwanted characters
				.replace(/\./g, ' ')
				.replace(/\s*-\s*/g, ' ')
				.replace(/\s*,\s*/g, ' ')
				.replace(/\s+/g, ' ')

				// Final cleanup
				.trim()
		);
	};

	private async processNewMovie(fullPath: string): Promise<void> {
		const fileExt = path.extname(fullPath).toLowerCase();

		if (this.supportedFormats.includes(fileExt)) {
			const movieId = path.basename(fullPath, fileExt);
			const movieTitle = this.cleanMovieName(movieId);
			await this.fetchImdbData(movieTitle, movieId, fullPath);
		}
	}

	removeMovieFromCache = (filePath: string) => {
		const movieId = Object.keys(this.movieCache).find(
			key => this.movieCache[key].filePath === filePath
		);
		movieId && delete this.movieCache[movieId];
	};

	fetchImdbData = (movieTitle: string, movieId: string, filePath: string) => {
		return new Promise<void>((resolve, reject) => {
			nameToImdb(movieTitle, async (err, imdbId, inf) => {
				if (err) {
					console.error(`Error fetching IMDB info for ${movieTitle}:`, err);
				}
				const movieCacheId = imdbId || movieId;
				if (!this.movieCache[movieCacheId]) {
					await this.fetchMetaDataAndInsertToCache(imdbId, movieCacheId, movieTitle, filePath);
				}
				resolve();
			});
		});
	};

	fetchMetaDataAndInsertToCache = async (
		imdbId: string | null,
		movieCacheId: string,
		movieTitle: string,
		filePath: string
	) => {
		let meta = {
			name: movieTitle,
			background: '',
			logo: '',
			type: 'movie',
			poster: '',
			description: 'Not found on IMDB',
		} as MovieMeta;
		const match = movieTitle.match(/S(\d{2})E(\d{2})/i);
		if (imdbId) {
			const type = match ? 'series' : 'movie';
			try {
				const { data } = await axios.get(
					'https://v3-cinemeta.strem.io/meta/' + type + '/' + imdbId + '.json'
				);
				if (data && data.meta && data.meta.name) {
					meta = data.meta;
				}
			} catch (e) {
				console.error(`Error fetching metadata for movie ${movieTitle}:`, e);
			}
		}
		const movieMeta = {
			...meta,
			behaviorHints: { ...meta.behaviorHints, defaultVideoId: movieCacheId },
			id: movieCacheId,
			filePath,
		};
		if (match) {
			const season = parseInt(match[1], 10);
			const episode = parseInt(match[2], 10);
			movieCacheId += `:${season}:${episode}`;
		}
		this.movieCache[movieCacheId] = movieMeta;

		const outputDir = path.dirname(filePath).replace('/movies', '/subs');
		if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

		if (imdbId && !fs.readdirSync(outputDir).length) {
			await this.subtitles.fetchSubtitles(imdbId, outputDir);
		}

		if (!fs.readdirSync(outputDir).length) {
			const subtitlePath = path.join(outputDir, `${movieCacheId}_ai.srt`);
			await this.whisper.transcribe(filePath, subtitlePath);
			this.subtitles.processSRTFile(subtitlePath);
		}

		this.subtitleCache[movieCacheId] = this.subtitles.getSubtitlesFromDir(outputDir);
	};
}

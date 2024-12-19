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
		watcher.on('add', filePath => {
			if (typeof filePath === 'string') this.processNewMovie(filePath);
		});
		watcher.on('unlink', filePath => {
			if (typeof filePath === 'string') this.removeMovieFromCache(filePath);
		});
		watcher.on('change', filePath => {
			if (typeof filePath === 'string') this.removeMovieFromCache(filePath);
			if (typeof filePath === 'string') this.processNewMovie(filePath);
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

	cleanMovieName = (name: string) => {
		return (
			name
				// First remove obvious release tags
				.replace(/\[.*?\]/g, '')
				.replace(/\(.*?\)/g, '')

				// Remove episode identifiers
				.replace(/\.?[SE]\d+[Ex]\d+/gi, '')

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

	private processNewMovie = (fullPath: string) => {
		const fileExt = path.extname(fullPath).toLowerCase();

		if (this.supportedFormats.includes(fileExt)) {
			const movieId = path.basename(fullPath, fileExt);
			if (!this.movieCache[movieId]) {
				const movieTitle = this.cleanMovieName(movieId);
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
			}
			await this.fetchMetaDataAndInsertToCache(imdbId, movieId, movieTitle, filePath);
		});
	};

	fetchMetaDataAndInsertToCache = async (
		imdbId: string | null,
		movieId: string,
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
		if (imdbId) {
			for (let type of ['movie', 'series']) {
				try {
					const { data } = await axios.get(
						'https://v3-cinemeta.strem.io/meta/' + type + '/' + imdbId + '.json'
					);
					if (data && data.meta) {
						meta = data.meta;
						break;
					}
				} catch (e) {
					console.error(`Error fetching metadata for movie ${movieTitle}:`, e);
					break;
				}
			}
		}
		this.movieCache[movieId] = {
			...meta,
			behaviorHints: { ...meta.behaviorHints, defaultVideoId: movieId },
			id: movieId, // Local Id
			filePath,
		};

		if (imdbId && !this.subtitleCache[movieId]) {
			await this.fetchSubtitles(movieId);
		}
	};

	fetchSubtitles = async (movieId: string) => {
		const outputDir = path
			.dirname(path.resolve(__dirname, this.movieCache[movieId].filePath))
			.replace('/movies', '/subs');
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
					if (!data.status || !data.subtitles.length) {
						break;
					}
					totalPages = data.totalPages;
					subtitles.push(...data.subtitles);
					page++;
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
			url: `${config.APP_URL}/api/subtitle-file?path=${encodeURIComponent(path.join(dir, file))}`,
		}));

		return filePaths;
	};
}

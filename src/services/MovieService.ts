import fs from 'fs';
import path from 'path';
import {
	MovieMeta,
	Subtitle,
	SubtitleResponse,
	SubtitleURL,
	GroupedEntry,
	SubtitleGroup,
} from '../interfaces/index.js';
import chokidar from 'chokidar';
import nameToImdb from 'name-to-imdb';
import axios from 'axios';
import * as unzipper from 'unzipper';
import config from '../config/index.js';
import { nodewhisper } from 'nodejs-whisper';
import SrtParser2, { Line } from 'srt-parser-2';
import { fileURLToPath } from 'url';

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

	constructor() {
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

		if (!this.subtitleCache[movieCacheId]) {
			const outputDir = path
				.dirname(path.resolve(__dirname, this.movieCache[movieCacheId].filePath))
				.replace('/movies', '/subs');
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}
			if (imdbId && !fs.readdirSync(outputDir).length) {
				await this.fetchSubtitles(movieCacheId, outputDir);
			}
			if (!fs.readdirSync(outputDir).length) {
				await this.generateSubtitlesWithWhisper(movieCacheId, outputDir);
			}
			this.subtitleCache[movieCacheId] = this.getSubtitlesFromDir(outputDir);
		}
	};

	fetchSubtitles = async (movieId: string, outputDir: string) => {
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
	};

	private async generateSubtitlesWithWhisper(movieId: string, outputDir: string) {
		try {
			const moviePath = this.movieCache[movieId].filePath;
			const outputSubtitlePath = path.join(outputDir, `${movieId}_ai.srt`);

			if (fs.existsSync(outputSubtitlePath)) {
				return;
			}

			const whisperOptions = {
				modelName: 'base',
				autoDownloadModelName: 'base',
				removeWavFileAfterTranscription: true,
				withCuda: false,
				whisperOptions: {
					outputInSrt: true,
					translateToEnglish: true,
					wordTimestamps: true,
					splitOnWord: true,
				},
			};

			await nodewhisper(moviePath, whisperOptions);

			const { name, dir } = path.parse(moviePath);
			const generatedSrtPath = path.join(dir, `${name}.wav.srt`);

			if (fs.existsSync(generatedSrtPath)) {
				this.moveFileSync(generatedSrtPath, outputSubtitlePath);
				this.processSRTFile(outputSubtitlePath);
			} else {
				throw new Error(`Expected SRT file not found at ${generatedSrtPath}`);
			}
		} catch (error) {
			console.error(`Error generating subtitles with Whisper for ${movieId}:`, error);
		}
	}

	private moveFileSync(src: string, dest: string) {
		try {
			fs.renameSync(src, dest);
		} catch (err: any) {
			if (err.code === 'EXDEV') {
				fs.copyFileSync(src, dest);
				fs.unlinkSync(src);
			} else {
				throw err;
			}
		}
	}

	timeToMs(timeString: string): number {
		if (!timeString) return 0;
		const [hms, ms] = timeString.split(',');
		const [h, m, s] = hms.split(':').map(Number);
		return h * 3600000 + m * 60000 + s * 1000 + parseInt(ms);
	}

	msToTime(ms: number): string {
		const hours = Math.floor(ms / 3600000);
		const minutes = Math.floor((ms % 3600000) / 60000);
		const seconds = Math.floor((ms % 60000) / 1000);
		const milliseconds = ms % 1000;

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
			.toString()
			.padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
	}

	processSRTFile(srtFile: string): void {
		try {
			const content = fs.readFileSync(srtFile, 'utf8');

			const parser = new SrtParser2();
			const entries = parser.fromSrt(content);

			const TIME_GAP_THRESHOLD = 1000;
			const MAX_SEGMENT_DURATION = 7000;
			const MAX_WORDS_PER_SEGMENT = 20;
			const MIN_SEGMENT_DURATION = 1000;
			const PUNCTUATION_STOP_REGEX = /[.!?]$/;
			const NOISE_WORDS = ['uh', 'um', 'ah', 'er', 'hmm'];

			const cleanedEntries = entries
				.filter(entry => {
					const words = entry.text.toLowerCase().trim().split(/\s+/);
					return (
						words.length > 0 &&
						!words.every(word => NOISE_WORDS.includes(word.replace(/[^\w]/g, '')))
					);
				})
				.map((entry, i) => {
					const startMs = this.timeToMs(entry.startTime);
					let endMs = this.timeToMs(entry.endTime);

					if (endMs <= startMs) {
						endMs = startMs + 1000;
					}

					return {
						...entry,
						startMs,
						endMs,
						text: entry.text.trim(),
					};
				});

			const groupedEntries: SubtitleGroup[] = [];
			let currentGroup: SubtitleGroup | null = null;

			for (let i = 0; i < cleanedEntries.length; i++) {
				const entry = cleanedEntries[i];

				if (!currentGroup) {
					currentGroup = {
						id: groupedEntries.length + 1,
						startTime: entry.startMs,
						endTime: entry.endMs,
						text: entry.text,
					};
					continue;
				}

				const timeDiff = entry.startMs - currentGroup.endTime;

				const newDuration = entry.endMs - currentGroup.startTime;
				const currentWordCount = currentGroup.text.split(/\s+/).length;
				const endsInPunctuation = PUNCTUATION_STOP_REGEX.test(currentGroup.text.trim());

				if (
					timeDiff > TIME_GAP_THRESHOLD ||
					newDuration > MAX_SEGMENT_DURATION ||
					currentWordCount >= MAX_WORDS_PER_SEGMENT ||
					endsInPunctuation
				) {
					groupedEntries.push(currentGroup);
					currentGroup = {
						id: groupedEntries.length + 1,
						startTime: entry.startMs,
						endTime: entry.endMs,
						text: entry.text,
					};
				} else {
					currentGroup.endTime = entry.endMs;
					currentGroup.text += ' ' + entry.text;
				}
			}

			if (currentGroup && currentGroup.text.trim()) {
				groupedEntries.push(currentGroup);
			}

			const processedGroups = groupedEntries.map(group => {
				if (group.endTime - group.startTime < MIN_SEGMENT_DURATION) {
					group.endTime = group.startTime + MIN_SEGMENT_DURATION;
				}

				group.text = group.text.trim().replace(/\s+/g, ' ');

				return group;
			});

			const formattedLines: Line[] = processedGroups.map(group => {
				return {
					id: group.id.toString(),
					startTime: this.msToTime(group.startTime),
					endTime: this.msToTime(group.endTime),
					text: group.text,
					startSeconds: group.startTime / 1000,
					endSeconds: group.endTime / 1000,
				};
			});

			const newSRTContent = parser.toSrt(formattedLines);
			fs.writeFileSync(srtFile, newSRTContent);
		} catch (error) {
			console.error('Error processing SRT file:', error instanceof Error ? error.message : error);
		}
	}

	doLinesOverlap(line1: any, line2: any): boolean {
		return line1.startMs < line2.endMs && line1.endMs > line2.startMs;
	}

	groupEntries(entries: Line[]): SubtitleGroup[] {
		const TIME_GAP_THRESHOLD = 1000;
		const MAX_SEGMENT_DURATION = 10000;
		const MAX_WORDS_PER_SEGMENT = 10;
		const PUNCTUATION_STOP_REGEX = /[.!?]/;

		const groupedEntries: SubtitleGroup[] = [];

		const firstEntry = entries[0];
		const firstStartMs = this.timeToMs(firstEntry.startTime.toString());
		const firstEndMs = this.timeToMs(firstEntry.endTime.toString());

		let currentGroup: SubtitleGroup = {
			id: 1,
			startTime: firstStartMs,
			endTime: firstEndMs,
			text: firstEntry.text,
		};

		for (let i = 1; i < entries.length; i++) {
			const entry = entries[i];

			const entryStartMs = this.timeToMs(entry.startTime.toString());
			const entryEndMs = this.timeToMs(entry.endTime.toString());

			const timeDiff = entryStartMs - currentGroup.endTime;
			const currentDuration = currentGroup.endTime - currentGroup.startTime;
			const currentWordCount = currentGroup.text.split(' ').length;

			const endsInPunctuation = PUNCTUATION_STOP_REGEX.test(currentGroup.text.trim().slice(-1));

			if (
				timeDiff > TIME_GAP_THRESHOLD ||
				currentDuration > MAX_SEGMENT_DURATION ||
				currentWordCount >= MAX_WORDS_PER_SEGMENT ||
				endsInPunctuation
			) {
				groupedEntries.push(currentGroup);
				currentGroup = {
					id: groupedEntries.length + 1,
					startTime: entryStartMs,
					endTime: entryEndMs,
					text: entry.text,
				};
			} else {
				currentGroup.endTime = entryEndMs;
				currentGroup.text += ' ' + entry.text;
			}
		}

		if (currentGroup.text.trim()) {
			groupedEntries.push(currentGroup);
		}

		return groupedEntries;
	}

	groupedEntriesToLines(groupedEntries: GroupedEntry[]): Line[] {
		return groupedEntries.map(entry => {
			const startTime = this.msToTime(entry.startTime);
			const endTime = this.msToTime(entry.endTime);

			const startSeconds = entry.startTime / 1000;
			const endSeconds = entry.endTime / 1000;

			return {
				id: entry.id.toString(),
				startTime,
				endTime,
				text: entry.text,
				startSeconds,
				endSeconds,
			};
		});
	}

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

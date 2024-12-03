import fs from 'fs';
import path from 'path';
import { MovieMeta } from '../interfaces';
import chokidar from 'chokidar';
import nameToImdb from 'name-to-imdb';
import axios from 'axios';

export class MovieService {
	supportedFormats = ['.mp4', '.webm', '.avi', '.mkv', '.mov', '.flv', '.wmv'];
	movieCache: { [x: string]: MovieMeta } = {};
	movieFolder = path.join(__dirname, '..', '..', 'movies');

	constructor() {
		this.getMovies();
		const watcher = chokidar.watch(this.movieFolder, { persistent: true });
		watcher.on('add', () => this.getMovies());
		watcher.on('unlink', filePath => {
			this.removeMovieFromCache(filePath);
		});
		watcher.on('change', filePath => {
			this.removeMovieFromCache(filePath);
			this.getMovies();
		});
	}

	getMovies = () => {
		const walkDirectory = (dir: string) => {
			const files = fs.readdirSync(dir);

			files.forEach(file => {
				const fullPath = path.join(dir, file);
				const stat = fs.statSync(fullPath);

				if (stat.isDirectory()) {
					walkDirectory(fullPath);
				} else if (stat.isFile()) {
					const fileExt = path.extname(file).toLowerCase();

					if (this.supportedFormats.includes(fileExt)) {
						const movieId = path.basename(file, fileExt);
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
				}
			});
		};

		walkDirectory(this.movieFolder);
	};

	removeMovieFromCache = (filePath: string) => {
		const movieId = Object.keys(this.movieCache).find(
			key => this.movieCache[key].filePath === filePath
		);
		movieId && delete this.movieCache[movieId];
	};

	fetchImdbData = (movieTitle: string, movieId: string, filePath: string) => {
		nameToImdb(movieTitle, (err, imdbId, inf) => {
			if (err) {
				console.error(`Error fetching IMDB info for ${movieTitle}:`, err);
			} else if (imdbId) {
				this.fetchMetaDataAndInsertToCache(imdbId, movieId, filePath);
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
	};
}

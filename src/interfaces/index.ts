export interface Config {
	dev: {
		APP_URL: string;
		PORT: number;
		AUTH_CODE: string;
		SUBDL_API_KEY: string;
		ENV: string;
	};
	prod: {
		APP_URL: string;
		PORT: number;
		AUTH_CODE: string;
		SUBDL_API_KEY: string;
		ENV: string;
	};
}

export interface MovieMeta {
	id: string;
	filePath: string;
	awards: string;
	cast: string[];
	country: string;
	description: string;
	director: string[];
	dvdRelease: string;
	genre: string[];
	imdbRating: string;
	imdb_id: string;
	moviedb_id: number;
	name: string;
	popularity: number;
	poster: string;
	released: string;
	runtime: string;
	trailers: {
		source: string;
		type: string;
	}[];
	type: string;
	writer: string[];
	year: string;
	background: string;
	logo: string;
	popularities: {
		moviedb: number;
		stremio: number;
		trakt: number;
		stremio_lib: number;
	};
	slug: string;
	genres: string[];
	releaseInfo: string;
	videos: any[];
	trailerStreams: {
		title: string;
		ytId: string;
	}[];
	links: {
		name: string;
		category: string;
		url: string;
	}[];
	behaviorHints: {
		defaultVideoId: string;
		hasScheduledVideos: boolean;
	};
}

export interface Subtitle {
	release_name: string;
	name: string;
	lang: string;
	author: string;
	url: string;
	subtitlePage: string;
	season: number;
	episode: number | null;
	language: string;
	hi: boolean;
	episode_from: number | null;
	episode_end: number;
	full_season: boolean;
}

interface Result {
	sd_id: number;
	type: string;
	name: string;
	imdb_id: string;
	tmdb_id: number;
	first_air_date: string | null;
	release_date: string;
	year: number;
}

export interface SubtitleResponse {
	status: boolean;
	results: Result[];
	subtitles: Subtitle[];
	totalPages: number;
	currentPage: number;
}

export interface SubtitleURL {
	id: string;
	lang: string;
	url: string;
}

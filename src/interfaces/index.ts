export interface Config {
	dev: {
		PORT: number;
		AUTH_CODE: string;
	};
	prod: {
		PORT: number;
		AUTH_CODE: string;
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

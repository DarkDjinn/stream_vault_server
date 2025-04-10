declare module 'name-to-imdb' {
	interface MetaData {
		id: string;
		name: string;
		year: number;
		type: 'TV series' | 'movie' | 'series' | string;
		yearRange?: string;
		image?: {
			src: string;
			width: number;
			height: number;
		};
		starring?: string;
		similarity?: number;
	}

	interface Info {
		match: string;
		isCached: boolean;
		meta: MetaData;
	}

	interface Options {
		name: string;
		year?: number;
		type?: 'movie' | 'series';
		providers?: Array<'imdbFind' | 'metadata'>;
	}

	// Callback-based API
	function nameToImdb(
		input: string | Options,
		callback: (err: Error | null, res: string | null, inf?: Info) => void
	): void;

	// Promise-based API
	function nameToImdb(input: string | Options): Promise<{ res: string; inf: Info }>;

	export = nameToImdb;
}

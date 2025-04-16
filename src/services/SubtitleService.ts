import fs from 'fs';
import path from 'path';
import axios from 'axios';
import unzipper from 'unzipper';
import SrtParser2, { Line } from 'srt-parser-2';
import config from '../config/index.js';
import { SubtitleGroup, GroupedEntry, Subtitle, SubtitleResponse } from '../interfaces/index.js';

export class SubtitleService {
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

	fetchSubtitles = async (imdbId: string, outputDir: string) => {
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
			console.error(`Error fetching subtitles for imdbId ${imdbId}:`, error);
		}
	};

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

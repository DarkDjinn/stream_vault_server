import fs from 'fs';
import path from 'path';
import { nodewhisper } from 'nodejs-whisper';

export class WhisperService {
	async transcribe(moviePath: string, outputSubtitlePath: string): Promise<void> {
		const { name, dir } = path.parse(moviePath);
		const generatedSrtPath = path.join(dir, `${name}.wav.srt`);

		if (fs.existsSync(outputSubtitlePath)) return;

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

		if (fs.existsSync(generatedSrtPath)) {
			this.moveFileSync(generatedSrtPath, outputSubtitlePath);
		} else {
			throw new Error(`Expected SRT file not found at ${generatedSrtPath}`);
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
}

import { Config } from '../interfaces';

const env = (process.env.NODE_ENV || 'dev') as keyof Config;

const config: Config = {
	dev: {
		PORT: 1338,
		AUTH_CODE: '',
	},
	prod: {
		PORT: 1338,
		AUTH_CODE: '',
	},
};

export default config[env];

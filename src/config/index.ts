import { Config } from '../interfaces';

const ENV = (process.env.NODE_ENV || 'dev') as keyof Config;
const PORT = 1338;

const config: Config = {
	dev: {
		APP_URL: '',
		PORT,
		AUTH_CODE: '',
		SUBDL_API_KEY: '',
		ENV,
	},
	prod: {
		APP_URL: '',
		PORT,
		AUTH_CODE: '',
		SUBDL_API_KEY: '',
		ENV,
	},
};

export default config[ENV];

import { createLogger, format, transports} from "winston"
const { combine, timestamp, label, printf, colorize } = format;
import 'winston-daily-rotate-file'

const formatLog = printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level.toUpperCase()}: ${message}`;
});

let transportApi = new (transports.DailyRotateFile)({
    filename: 'logs/%DATE%_tx-cardano.log',
    datePattern: 'YYYY-MM-DD'
})

const newLogger = createLogger({
    format: combine(
        timestamp(), // Print time stamp
        formatLog, // Use our customized format
        colorize({
            colors: { info: 'green', error: 'red' }
        })
    ),
    transports: [
        transportApi,
        new transports.Console(),
    ]
});

export const logger = {
    print(msg) {
        newLogger.info(`${msg}`); // Outputs a message
    },
};
import { BaseLogger } from "./BaseLogger";
export { BaseLogger };


export class Logger<LogObj> extends BaseLogger<LogObj> {

    public constructor(settings?: any, logObj?: LogObj) {
        super(settings, logObj, 5);
    }

    /**
     * Logs a silly message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public silly(...args: unknown[]): any {
        return this.log(0, "SILLY", ...args);
    }

    /**
     * Logs a trace message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public trace(...args: unknown[]): any {
        return this.log(1, "TRACE", ...args);
    }

    /**
     * Logs a debug message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public debug(...args: unknown[]): any {
        return this.log(2, "DEBUG", ...args);
    }

    /**
     * Logs an info message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public info(...args: unknown[]): any {
        return this.log(3, "INFO", ...args);
    }

    /**
     * Logs a warn message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public warn(...args: unknown[]): any {
        return this.log(4, "WARN", ...args);
    }

    /**
     * Logs an error message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public error(...args: unknown[]): any {
        return this.log(5, "ERROR", ...args);
    }

    /**
     * Logs a fatal message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    public fatal(...args: unknown[]): any {
        return this.log(6, "FATAL", ...args);
    }
}

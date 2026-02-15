use indicatif::ProgressBar;
use lazy_static::lazy_static;
use std::sync::Mutex;

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Verbosity {
    Quite,
    Error,
    Warning,
    Standard,
    Info,
    Verbose,
}

pub struct Logger {
    verbosity: Verbosity,
}

const ANSI_GREEN: &str = "\u{001b}[32m";
const ANSI_RED: &str = "\u{001b}[31m";
const ANSI_YELLOW: &str = "\u{001b}[33m";
const ANSI_RESET: &str = "\u{001b}[0m";

impl Logger {
    pub fn new(verbosity: Verbosity) -> Self {
        Logger { verbosity }
    }

    fn remove_trailing_newline(&self, text: &str) -> String {
        text.trim_end_matches('\n').to_string()
    }

    pub fn log(&self, message: &str, level: Verbosity) {
        if self.should_log_message(level) {
            let trimmed = self.remove_trailing_newline(message);
            println!("{}", colorize_status_lines(&trimmed));
        }
    }

    fn should_log_message(&self, level: Verbosity) -> bool {
        match self.verbosity {
            Verbosity::Quite => false,
            Verbosity::Error => level == Verbosity::Error,
            Verbosity::Warning => level == Verbosity::Warning || level == Verbosity::Error,
            Verbosity::Standard => {
                level == Verbosity::Standard
                    || level == Verbosity::Warning
                    || level == Verbosity::Error
            }
            Verbosity::Info => {
                level == Verbosity::Info
                    || level == Verbosity::Standard
                    || level == Verbosity::Warning
                    || level == Verbosity::Error
            }
            Verbosity::Verbose => true,
        }
    }
}

fn colorize_status_lines(message: &str) -> String {
    message
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with("PASS:")
                || trimmed.starts_with("PASS ")
                || trimmed.starts_with("[OK]")
            {
                format!("{ANSI_GREEN}{line}{ANSI_RESET}")
            } else if trimmed.starts_with("FAIL:")
                || trimmed.starts_with("FAIL ")
                || trimmed.starts_with("[FAIL]")
            {
                format!("{ANSI_RED}{line}{ANSI_RESET}")
            } else if trimmed.starts_with("SKIP:")
                || trimmed.starts_with("SKIP ")
                || trimmed.starts_with("[WARN]")
            {
                format!("{ANSI_YELLOW}{line}{ANSI_RESET}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

lazy_static! {
    pub static ref LOGGER: Mutex<Logger> = Mutex::new(Logger::new(Verbosity::Standard));
}

fn parse_verbosity(verbosity: usize) -> Verbosity {
    match verbosity {
        0 => Verbosity::Quite,
        1 => Verbosity::Standard,
        2 => Verbosity::Warning,
        3 => Verbosity::Error,
        4 => Verbosity::Info,
        _ => Verbosity::Verbose,
    }
}

pub fn init(verbosity: usize) {
    let mut logger = LOGGER.lock().unwrap();
    *logger = Logger::new(parse_verbosity(verbosity));
}

pub fn log(message: &str) {
    let logger = LOGGER.lock().unwrap();
    logger.log(message, Verbosity::Standard);
}

pub fn error(message: &str) {
    let logger = LOGGER.lock().unwrap();
    logger.log(message, Verbosity::Error);
}

pub fn warn(message: &str) {
    let logger = LOGGER.lock().unwrap();
    logger.log(message, Verbosity::Warning);
}

pub fn info(message: &str) {
    let logger = LOGGER.lock().unwrap();
    logger.log(message, Verbosity::Info);
}

pub fn verbose(message: &str) {
    let logger = LOGGER.lock().unwrap();
    logger.log(message, Verbosity::Verbose);
}

pub fn get_verbosity() -> Verbosity {
    LOGGER.lock().unwrap().verbosity.clone()
}

pub fn is_quite() -> bool {
    get_verbosity() == Verbosity::Quite
}

pub fn log_or_show_progress(message: &str, optional_progress_bar: &Option<ProgressBar>) {
    if let Some(progress_bar) = optional_progress_bar {
        progress_bar.set_message(message.to_owned());
    } else {
        log(message);
    }
}

pub fn log_or_print_progress(message: &str, optional_progress_bar: &Option<ProgressBar>) {
    if let Some(progress_bar) = optional_progress_bar {
        progress_bar.println(message.to_owned());
    } else {
        log(message);
    }
}

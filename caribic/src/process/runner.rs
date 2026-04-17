use crate::logger;
use indicatif::{ProgressBar, ProgressStyle};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub enum StreamKind {
    Stdout,
    Stderr,
}

pub struct StreamingOptions<'a> {
    pub label: &'a str,
    pub heartbeat_interval: Option<Duration>,
    pub log_failure_output: bool,
}

impl<'a> StreamingOptions<'a> {
    pub fn new(label: &'a str) -> Self {
        Self {
            label,
            heartbeat_interval: None,
            log_failure_output: false,
        }
    }
}

pub fn run_output(command: &mut Command) -> Result<Output, String> {
    let command_display = format_command(command);
    let output = command
        .output()
        .map_err(|error| format!("Failed to run `{}`: {}", command_display, error))?;

    Ok(output)
}

pub fn run_ok_output(command: &mut Command) -> Result<Output, String> {
    let command_display = format_command(command);
    let output = run_output(command)?;

    if output.status.success() {
        return Ok(output);
    }

    Err(format!(
        "`{}` failed (exit code {}): {}",
        command_display,
        output.status.code().unwrap_or(-1),
        best_output_details(&output)
    ))
}

pub fn run_inherit_status(command: &mut Command) -> Result<(), String> {
    let command_display = format_command(command);
    let status = command
        .status()
        .map_err(|error| format!("Failed to run `{}`: {}", command_display, error))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "`{}` failed (exit code {})",
            command_display,
            status.code().unwrap_or(-1)
        ))
    }
}

pub fn run_output_streaming<F>(
    command: &mut Command,
    options: StreamingOptions<'_>,
    mut on_line: F,
) -> Result<Output, String>
where
    F: FnMut(StreamKind, &str),
{
    let command_display = format_command(command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn `{}`: {}", command_display, error))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Failed to capture stdout for `{}`", command_display))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Failed to capture stderr for `{}`", command_display))?;

    let (sender, receiver) = mpsc::channel::<(StreamKind, String)>();

    let stdout_sender = sender.clone();
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = stdout_sender.send((StreamKind::Stdout, line));
        }
    });

    let stderr_sender = sender.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = stderr_sender.send((StreamKind::Stderr, line));
        }
    });

    drop(sender);

    let started_at = Instant::now();
    let mut next_heartbeat = options
        .heartbeat_interval
        .map(|interval| started_at + interval);
    let mut channel_closed = false;
    let mut status = None;
    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    loop {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok((stream, line)) => {
                match stream {
                    StreamKind::Stdout => {
                        stdout_buf.push_str(&line);
                        stdout_buf.push('\n');
                    }
                    StreamKind::Stderr => {
                        stderr_buf.push_str(&line);
                        stderr_buf.push('\n');
                    }
                }
                on_line(stream, line.as_str());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                channel_closed = true;
            }
        }

        if status.is_none() {
            status = child.try_wait().map_err(|error| {
                format!("Failed while waiting on `{}`: {}", command_display, error)
            })?;
        }

        if let (None, Some(deadline)) = (status, next_heartbeat) {
            if Instant::now() >= deadline {
                logger::log(&format!(
                    "{} still running after {}s: {}",
                    options.label,
                    started_at.elapsed().as_secs(),
                    command_display
                ));
                next_heartbeat = options
                    .heartbeat_interval
                    .map(|interval| Instant::now() + interval);
            }
        }

        if channel_closed && status.is_some() {
            break;
        }
    }

    let status = status.unwrap_or_else(|| child.wait().expect("child already spawned"));
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if !status.success()
        && options.log_failure_output
        && logger::get_verbosity() != logger::Verbosity::Quite
    {
        let stdout_tail = tail_preview(&stdout_buf, 20);
        let stderr_tail = tail_preview(&stderr_buf, 20);

        logger::warn(&format!(
            "{} failed after {:.2}s with exit code {:?}",
            options.label,
            started_at.elapsed().as_secs_f32(),
            status.code()
        ));
        if !stdout_tail.is_empty() {
            logger::warn(&format!("{} stdout tail:\n{}", options.label, stdout_tail));
        }
        if !stderr_tail.is_empty() {
            logger::warn(&format!("{} stderr tail:\n{}", options.label, stderr_tail));
        }
    }

    Ok(Output {
        status,
        stdout: stdout_buf.into_bytes(),
        stderr: stderr_buf.into_bytes(),
    })
}

pub fn run_with_spinner(command: &mut Command, start_message: &str) -> Result<Output, String> {
    let progress_bar = ProgressBar::new_spinner();
    progress_bar.enable_steady_tick(Duration::from_millis(100));
    progress_bar.set_style(
        ProgressStyle::with_template("{prefix:.bold} {spinner} {wide_msg}")
            .unwrap()
            .tick_chars("⠁⠂⠄⡀⢀⠠⠐⠈ "),
    );
    progress_bar.set_prefix(start_message.to_owned());

    let verbosity = logger::get_verbosity();
    let mut last_lines = VecDeque::with_capacity(5);
    let output = run_output_streaming(command, StreamingOptions::new(start_message), |_, line| {
        match verbosity {
            logger::Verbosity::Verbose => {
                progress_bar.set_message(line.trim().to_string());
            }
            logger::Verbosity::Info => {
                if last_lines.len() == 5 {
                    last_lines.pop_front();
                }
                last_lines.push_back(line.to_string());
                progress_bar.set_message(
                    last_lines
                        .iter()
                        .cloned()
                        .collect::<Vec<String>>()
                        .join("\n"),
                );
            }
            logger::Verbosity::Standard => {
                progress_bar.set_message(line.trim().to_string());
            }
            _ => {}
        }
    });

    progress_bar.finish_and_clear();
    output
}

pub fn format_command(command: &Command) -> String {
    let program = command.get_program().to_string_lossy();
    let args = command
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    if args.is_empty() {
        program.to_string()
    } else {
        format!("{} {}", program, args.join(" "))
    }
}

pub fn best_output_details(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "no output".to_string()
    }
}

fn tail_preview(text: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..]
        .iter()
        .map(|line| format!("   [tail] {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Mutex, OnceLock},
};

use tracing_subscriber::{EnvFilter, fmt, fmt::MakeWriter};

const MAX_LOG_LINES: usize = 2000;

pub type LogBuffer = Arc<Mutex<VecDeque<String>>>;

static LOG_BUFFER: OnceLock<LogBuffer> = OnceLock::new();

pub fn init_logging() {
    let buffer = LOG_BUFFER
        .get_or_init(|| Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES))))
        .clone();

    let make_writer = LogMakeWriter { buffer };
    fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .with_writer(make_writer)
        .init();
}

pub fn get_logs(limit: Option<usize>) -> Vec<String> {
    let limit = limit.unwrap_or(200).min(MAX_LOG_LINES);
    let Some(buffer) = LOG_BUFFER.get() else {
        return Vec::new();
    };
    let guard = buffer.lock().unwrap();
    let total = guard.len();
    let start = total.saturating_sub(limit);
    guard.iter().skip(start).cloned().collect()
}

#[derive(Clone)]
struct LogMakeWriter {
    buffer: LogBuffer,
}

impl<'a> MakeWriter<'a> for LogMakeWriter {
    type Writer = LogWriter;

    fn make_writer(&'a self) -> Self::Writer {
        LogWriter {
            buffer: self.buffer.clone(),
            line: Vec::new(),
            stdout: io::stdout(),
        }
    }
}

struct LogWriter {
    buffer: LogBuffer,
    line: Vec<u8>,
    stdout: io::Stdout,
}

impl LogWriter {
    fn push_line(&self, line: &[u8]) {
        if line.is_empty() {
            return;
        }
        let mut guard = self.buffer.lock().unwrap();
        if guard.len() >= MAX_LOG_LINES {
            guard.pop_front();
        }
        let cleaned = strip_ansi(line);
        guard.push_back(cleaned.trim_end().to_string());
    }

    fn capture(&mut self, buf: &[u8]) {
        for &byte in buf {
            if byte == b'\n' {
                self.push_line(&self.line);
                self.line.clear();
            } else {
                self.line.push(byte);
            }
        }
    }
}

impl Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.stdout.write_all(buf)?;
        self.capture(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stdout.flush()?;
        if !self.line.is_empty() {
            self.push_line(&self.line);
            self.line.clear();
        }
        Ok(())
    }
}

impl Drop for LogWriter {
    fn drop(&mut self) {
        if !self.line.is_empty() {
            self.push_line(&self.line);
            self.line.clear();
        }
    }
}

fn strip_ansi(input: &[u8]) -> String {
    let mut output = Vec::with_capacity(input.len());
    let mut idx = 0;
    while idx < input.len() {
        if input[idx] == 0x1b {
            idx += 1;
            if idx < input.len() && input[idx] == b'[' {
                idx += 1;
                while idx < input.len() && !(input[idx] >= b'@' && input[idx] <= b'~') {
                    idx += 1;
                }
                if idx < input.len() {
                    idx += 1;
                }
                continue;
            }
        }
        output.push(input[idx]);
        idx += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

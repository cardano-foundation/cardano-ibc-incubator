use reqwest::Client;
use std::future::Future;
use std::time::Duration;

pub struct HttpHealthClient {
    client: Client,
}

impl HttpHealthClient {
    pub fn new(connect_timeout: Duration, request_timeout: Duration) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(connect_timeout)
            .timeout(request_timeout)
            .build()
            .map_err(|error| format!("Failed to build HTTP health client: {}", error))?;
        Ok(Self { client })
    }

    pub fn response_contains(&self, url: &str, expected: &str) -> bool {
        self.run(async {
            let Ok(response) = self.client.get(url).send().await else {
                return false;
            };
            if !response.status().is_success() {
                return false;
            }

            response
                .text()
                .await
                .map(|body| body.contains(expected))
                .unwrap_or(false)
        })
    }

    pub fn responds_ok(&self, url: &str) -> bool {
        self.run(async {
            self.client
                .get(url)
                .send()
                .await
                .map(|response| response.status().is_success())
                .unwrap_or(false)
        })
    }

    fn run<F>(&self, future: F) -> bool
    where
        F: Future<Output = bool>,
    {
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            // Health checks are called from both sync code and Tokio-driven command handlers.
            // `block_in_place` keeps the sync call-site simple without tripping Tokio's
            // "drop a blocking runtime in async context" panic.
            tokio::task::block_in_place(|| handle.block_on(future))
        } else {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map(|runtime| runtime.block_on(future))
                .unwrap_or(false)
        }
    }
}

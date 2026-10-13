use axum::http::HeaderMap;
use governor::clock::{Clock, DefaultClock};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;

const SIGN_IN_PER_MINUTE: u32 = 30;
const SYNC_PER_MINUTE: u32 = 600;
const JOINS_PER_MINUTE: u32 = 5;
const REFUSED_PER_MINUTE: u32 = 20;
const DEVICE_TOKEN_PER_MINUTE: u32 = 10;

pub struct Limits {
    sign_in: DefaultKeyedRateLimiter<IpAddr>,
    device_token: DefaultKeyedRateLimiter<IpAddr>,
    sync: DefaultKeyedRateLimiter<String>,
    joins: DefaultKeyedRateLimiter<String>,
    refused: DefaultKeyedRateLimiter<IpAddr>,
}

fn per_minute<K: Hash + Eq + Clone>(n: u32) -> DefaultKeyedRateLimiter<K> {
    RateLimiter::keyed(Quota::per_minute(
        NonZeroU32::new(n).unwrap_or(NonZeroU32::MIN),
    ))
}

fn check<K: Hash + Eq + Clone>(limiter: &DefaultKeyedRateLimiter<K>, key: &K) -> Result<(), u64> {
    limiter.check_key(key).map_err(|not_until| {
        not_until
            .wait_time_from(DefaultClock::default().now())
            .as_secs()
            .max(1)
    })
}

pub fn client_ip(trust_proxy: bool, peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
    if trust_proxy {
        let forwarded = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit(',').next())
            .and_then(|v| v.trim().parse().ok());
        if let Some(ip) = forwarded {
            return ip;
        }
    }
    peer.ip()
}

impl Limits {
    pub fn new() -> Self {
        Limits {
            sign_in: per_minute(SIGN_IN_PER_MINUTE),
            device_token: per_minute(DEVICE_TOKEN_PER_MINUTE),
            sync: per_minute(SYNC_PER_MINUTE),
            joins: per_minute(JOINS_PER_MINUTE),
            refused: per_minute(REFUSED_PER_MINUTE),
        }
    }

    pub fn sign_in(&self, ip: IpAddr) -> Result<(), u64> {
        check(&self.sign_in, &ip)
    }

    pub fn forget_idle(&self) {
        self.sign_in.retain_recent();
        self.device_token.retain_recent();
        self.sync.retain_recent();
        self.joins.retain_recent();
        self.refused.retain_recent();
    }

    pub fn device_token(&self, ip: IpAddr) -> Result<(), u64> {
        check(&self.device_token, &ip)
    }

    pub fn sync(&self, grant: &str) -> Result<(), u64> {
        check(&self.sync, &grant.to_string())
    }

    pub fn join(&self, sub: &str) -> Result<(), u64> {
        check(&self.joins, &sub.to_string())
    }

    pub fn refused(&self, ip: IpAddr) -> Result<(), u64> {
        check(&self.refused, &ip)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_in_allows_thirty_a_minute_per_address() {
        let limits = Limits::new();
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        for _ in 0..SIGN_IN_PER_MINUTE {
            assert!(limits.sign_in(a).is_ok());
        }
        assert!(limits.sign_in(a).unwrap_err() >= 1);
        assert!(limits.sign_in(b).is_ok());
    }

    #[test]
    fn the_address_the_trusted_proxy_appended_counts_not_one_the_client_wrote() {
        let peer: SocketAddr = "192.168.1.5:4000".parse().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "1.2.3.4, 203.0.113.9".parse().unwrap());
        assert_eq!(client_ip(false, peer, &headers), peer.ip());
        assert_eq!(
            client_ip(true, peer, &headers),
            "203.0.113.9".parse::<IpAddr>().unwrap()
        );
        assert_eq!(client_ip(true, peer, &HeaderMap::new()), peer.ip());
    }
}

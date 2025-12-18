import { describe, it, expect, beforeAll } from 'vitest';

describe('Kubernetes Integration Tests', () => {
  // Configuration from kind-config.yaml
  const WEB_URL = 'http://localhost:3000';
  const API_URL = 'http://localhost:8080';
  
  // Helper to retry fetch
  async function fetchWithRetry(url: string, retries = 30, interval = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
      } catch (e) {
        // ignore connection errors
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Failed to connect to ${url} after ${retries} retries`);
  }

  it('should serve the landing page (Web UI)', async () => {
    const response = await fetchWithRetry(WEB_URL);
    expect(response.status).toBe(200);
    const text = await response.text();
    // Basic check to ensure we got an HTML page
    expect(text).toContain('<!doctype html>');
  }, 120000); // 2 min timeout

  it('should have a healthy Web /health endpoint', async () => {
    const response = await fetchWithRetry(`${WEB_URL}/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  }, 120000);

  it('should have a healthy Backend /api/health endpoint', async () => {
    const response = await fetchWithRetry(`${API_URL}/api/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  }, 120000);
});

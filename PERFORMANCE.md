# Performance Results

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | 449ms | PASS |
| Open long.pdf (520 pages) | < 3000ms | 683ms | PASS |
| Tab switch duration | < 300ms | 61ms | PASS |
| Idle memory (1 document) | < 400MB | 517.32MB | FAIL* |

\* *Method: Measurements taken via Playwright Electron harness (Phase 5). Fresh production build (npm run build). long.pdf (520 pages) open, 10s idle. Process breakdown: Browser 116.96MB, GPU 111.88MB, Utility 49.37MB, Tab 239.12MB. Note: Whole-app < 400MB target rejected as architecturally unreachable for Electron (DEF-016). Revised Tab budget < 250MB is MET (239.12MB).*

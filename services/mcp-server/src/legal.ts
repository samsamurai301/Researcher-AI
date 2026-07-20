const PAGE_STYLE = `
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0 auto; max-width: 760px; padding: 48px 24px 80px; line-height: 1.6; }
  h1, h2 { line-height: 1.2; }
  h2 { margin-top: 2rem; }
  a { color: #16865b; }
  .meta { opacity: .72; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;
}

export const PRIVACY_HTML = page("Researcher AI Privacy Policy", `
  <h1>Researcher AI Privacy Policy</h1>
  <p class="meta">Effective July 20, 2026</p>
  <p>This policy covers the public Researcher AI ChatGPT review service operated by Sohangkumar Patel (GitHub: samsamurai301). The service is a deterministic mock integration for evaluating research workflows. It does not run live AI Scientist experiments or send prompts to model providers.</p>
  <h2>Data we process</h2>
  <p>We process the research titles, keywords, questions, abstracts, tool inputs, and mock artifacts you submit. The hosting provider may process standard network and service metadata, such as IP address, request time, response status, and user agent, to operate and secure the service.</p>
  <h2>How we use data</h2>
  <p>Data is used only to provide the requested mock workflow, isolate temporary processing, diagnose failures, prevent abuse, and meet legal obligations. We do not sell personal data, use it for advertising, or use it to train models.</p>
  <h2>Storage and retention</h2>
  <p>Each public mock workflow uses a random, server-generated identifier that is hashed before it is used in a filesystem path. The workflow deletes its temporary project and artifact files before returning the result. The hosting provider may retain standard network or service logs according to its operational retention practices. Do not submit confidential, regulated, or personally identifying information.</p>
  <h2>Sharing</h2>
  <p>Data is shared only with infrastructure providers as needed to host and secure the service, or when required by law. The public review service does not call external model or literature providers.</p>
  <h2>Your choices</h2>
  <p>For access, correction, deletion, or privacy questions, use the <a href="https://github.com/samsamurai301/Researcher-AI/issues">Researcher AI support tracker</a>. Do not include sensitive personal data in a public issue; request a private contact channel instead.</p>
  <h2>Security and changes</h2>
  <p>We use bounded inputs, per-call isolation, hashed storage paths, immediate temporary-state deletion, a non-privileged container, and a mock-only public runner. No internet service is risk-free. Material policy changes will be published here with a new effective date.</p>
`);

export const TERMS_HTML = page("Researcher AI Terms of Service", `
  <h1>Researcher AI Terms of Service</h1>
  <p class="meta">Effective July 20, 2026</p>
  <p>These terms govern use of the public Researcher AI ChatGPT review service operated by Sohangkumar Patel (GitHub: samsamurai301). By using the service, you agree to these terms.</p>
  <h2>Service scope</h2>
  <p>The public service demonstrates Researcher AI with deterministic mock outputs. It does not execute live AI Scientist experiments, make model-provider calls, validate a hypothesis, or provide scientific, medical, legal, financial, or professional advice.</p>
  <h2>Responsible use</h2>
  <p>You must not use the service to break laws, harm others, probe or disrupt infrastructure, bypass access controls, upload malware, submit confidential or regulated data, or misrepresent mock artifacts as real scientific evidence. You remain responsible for verifying outputs, citations, licenses, and publication claims.</p>
  <h2>Machine-generation disclosure</h2>
  <p>Generated scientific manuscripts and technical reports must retain the disclosure required by the pinned AI Scientist v2 license: human reviewers remain responsible for verification, attribution, and publication decisions.</p>
  <h2>Your content</h2>
  <p>You retain rights in content you submit. You grant the operator a limited license to process that content only to provide, secure, and troubleshoot the service. Submitted content is handled according to the <a href="/privacy">Privacy Policy</a>.</p>
  <h2>Availability and warranties</h2>
  <p>The service is provided on an “as is” and “as available” basis for evaluation. Features may change, sessions may expire, and availability is not guaranteed. To the maximum extent permitted by applicable law, the operator disclaims implied warranties and is not liable for indirect, incidental, special, consequential, or lost-profit damages arising from use of the service.</p>
  <h2>Suspension and changes</h2>
  <p>Access may be limited or suspended to protect users, infrastructure, or legal compliance. Material changes to these terms will be published here with a new effective date. Continued use after a change means acceptance of the revised terms.</p>
  <h2>Contact</h2>
  <p>Questions can be submitted through the <a href="https://github.com/samsamurai301/Researcher-AI/issues">Researcher AI support tracker</a>.</p>
`);

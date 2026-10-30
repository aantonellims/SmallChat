import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import App from '@/App';
import { checklistSrc } from '@/lib/checklist-src';

describe('checklistSrc', () => {
  it('points the bundled checklist page at the agent API', () => {
    const src = checklistSrc('https://agent.example.com/', 'https://app.example.com/');
    expect(src).toBe('https://app.example.com/checklist/index.html?api=https%3A%2F%2Fagent.example.com');
  });

  it('omits the api parameter when none is configured', () => {
    expect(checklistSrc('', 'https://app.example.com/x/')).toBe('https://app.example.com/x/checklist/index.html');
  });
});

describe('App', () => {
  it('renders the checklist page in a same-origin frame', () => {
    const { container } = render(<App />);
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toContain('checklist/index.html');
  });
});

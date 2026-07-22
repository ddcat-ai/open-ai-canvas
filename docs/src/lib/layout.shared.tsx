import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName } from './shared';
import { ArrowUpRight } from 'lucide-react';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt={appName} className="h-6 w-6" />
          <span>{appName}</span>
        </span>
      ),
    },
    links: [
      {
        text: '文档导航',
        url: '/docs/overview/quick-start',
        on: 'nav',
      },
      {
        text: (
          <span className="inline-flex items-center gap-1.5">
            <span>在线体验</span>
            <ArrowUpRight className="size-4" />
          </span>
        ),
        url: 'https://canvas.best/',
        external: true,
        on: 'nav',
      },
    ],
  };
}

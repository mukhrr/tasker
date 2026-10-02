'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
          success:
            '!bg-green-50 !text-green-800 !border-green-200 dark:!bg-green-950 dark:!text-green-200 dark:!border-green-800',
          error:
            '!bg-red-50 !text-red-800 !border-red-200 dark:!bg-red-950 dark:!text-red-200 dark:!border-red-800',
          warning:
            '!bg-amber-50 !text-amber-800 !border-amber-200 dark:!bg-amber-950 dark:!text-amber-200 dark:!border-amber-800',
          info: '!bg-blue-50 !text-blue-800 !border-blue-200 dark:!bg-blue-950 dark:!text-blue-200 dark:!border-blue-800',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

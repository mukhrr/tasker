'use client';

import { Background, FloatingLines } from '@/components/landing/background';
import { CtaSection } from '@/components/landing/cta-section';
import { JSON_LD } from '@/components/landing/data';
import { FeaturesSection } from '@/components/landing/features-section';
import { Footer } from '@/components/landing/footer';
import { Header } from '@/components/landing/header';
import { HeroSection } from '@/components/landing/hero-section';
import { useParallax } from '@/components/landing/hooks';

export default function HomePage() {
  const { scrollY, transform } = useParallax();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <Background transform={transform} />
      <FloatingLines transform={transform} />
      <Header />

      <main>
        <HeroSection scrollY={scrollY} />
        <FeaturesSection />
        <CtaSection />
      </main>

      <Footer />
    </div>
  );
}

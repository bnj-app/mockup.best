import type { Metadata } from 'next';
import { LegalPage, Section } from '@/components/LegalPage';
import { BRAND } from '@/config/brand';
import { CONTACT_EMAIL } from '@/config/legal';

export const metadata: Metadata = {
  title: `Terms of Service — ${BRAND.name}`,
  description: `The terms for using ${BRAND.name}. You keep all rights to what you create.`,
  alternates: { canonical: '/terms/' },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms cover your use of {BRAND.name} at{' '}
        <a href={BRAND.siteUrl}>{BRAND.siteUrl.replace('https://', '')}</a>. By using the site you
        agree to them.
      </p>

      <Section title="What you get">
        <p>
          {BRAND.name} is a browser tool for placing product screens into device mockups and
          scenes, and exporting them as images or video. Every feature is currently free for
          everyone: unlimited exports, no watermark, no account. There is no paid plan today. If
          one is introduced later, the features that are free now may change, and we will say so
          on this page before it happens.
        </p>
      </Section>

      <Section title="Your content stays yours">
        <p>
          You keep every right to the screenshots, recordings and designs you bring in, and to the
          images and videos you export. We claim no ownership and no licence over them. Because
          your files never reach our servers, we could not use them even if we wanted to.
        </p>
        <p>
          You are responsible for having the right to use what you upload — for example, not
          putting someone else&rsquo;s copyrighted material or another company&rsquo;s branding
          into a mockup you then publish.
        </p>
      </Section>

      <Section title="Fair use">
        <p>Please do not use {BRAND.name} to:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>create material that is illegal where you live, or that harasses or defames someone</li>
          <li>impersonate a real company or person, or fabricate screenshots meant to deceive</li>
          <li>attack, overload or attempt to break the service or the machine it runs on</li>
        </ul>
      </Section>

      <Section title="Availability">
        <p>
          {BRAND.name} is offered as-is. It is a young product and it may change, break, or go
          offline for maintenance without notice. We do not guarantee uptime, and we do not
          guarantee that any particular feature will keep working or keep existing.
        </p>
      </Section>

      <Section title="Your work is not backed up">
        <p>
          Projects live in your browser&rsquo;s local storage, not on a server. Clearing your
          browser data, using private browsing, or switching devices will lose them. Export
          anything you care about, and use <em>Save project</em> to keep a file copy. We cannot
          recover lost work.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          To the extent the law allows, {BRAND.name} is not liable for lost work, lost income, or
          any indirect damage arising from use of the service. Nothing here limits rights you have
          as a consumer that cannot be waived.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </LegalPage>
  );
}

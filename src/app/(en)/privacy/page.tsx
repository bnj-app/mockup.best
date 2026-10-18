import type { Metadata } from 'next';
import { LegalPage, Section } from '@/components/LegalPage';
import { BRAND } from '@/config/brand';
import { CONTACT_EMAIL } from '@/config/legal';

export const metadata: Metadata = {
  title: `Privacy Policy — ${BRAND.name}`,
  description: `How ${BRAND.name} handles your files and data. Short version: your files never leave your device.`,
  alternates: { canonical: '/privacy/' },
};

/*
  Describe actual application behavior: static export with no server or
  accounts, no file uploads, projects in localStorage, files and shelf in
  IndexedDB, and cookie-free Umami analytics hosted on our own server.
  Update this text whenever behavior changes; an inaccurate privacy
  statement is worse than none.
*/
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        <strong>The short version: your files never leave your device.</strong> {BRAND.name} runs
        entirely in your browser. There is no account, no upload, and no server that stores your
        work.
      </p>

      <Section title="Your images and videos">
        <p>
          When you add a screenshot or a video, it is read directly by your browser and rendered on
          your own machine. It is never transmitted to us and we never see it. Exported images and
          videos are produced locally and saved straight to your downloads folder.
        </p>
      </Section>

      <Section title="Your projects">
        <p>
          Scenes, camera moves and settings are saved in your browser&rsquo;s local storage so that
          your work survives a refresh. The files of the open project, and any projects you save
          under <em>Projects on this device</em>, are kept in your browser&rsquo;s own database
          (IndexedDB) so they come back after a refresh too. All of this stays on your device and is
          never uploaded. You can turn off keeping files, or remove every saved project and file, in
          that same window. Clearing your browser data deletes it permanently — we hold no copy and
          cannot restore it.
        </p>
        <p>
          When you use <em>Hide private info</em>, the covered areas are burned into the image. The
          original is kept only in the open tab&rsquo;s memory so you can undo; it is never written to
          storage, a project file, a share link or an export.
        </p>
        <p>
          Share links encode the project into the link itself. They contain your scene setup but
          <strong> not your media</strong>, and nothing is stored on our side when you create one.
        </p>
      </Section>

      <Section title="Analytics">
        <p>
          We measure basic, aggregated usage — page views, which features are used, which browser
          and country a visit came from — using a self-hosted{' '}
          <a href="https://umami.is" rel="noopener noreferrer" target="_blank">
            Umami
          </a>{' '}
          instance running on our own server. It sets <strong>no cookies</strong>, does not
          fingerprint you, does not track you across other websites, and no data is shared with or
          sold to third parties.
        </p>
        <p>
          We also record anonymous error reports (an error message and the browser it happened in)
          so we can fix crashes. These never include your files, your project content, or file
          paths from your machine.
        </p>
      </Section>

      <Section title="What we do not do">
        <p>
          We do not sell data. We do not run advertising. We do not use tracking cookies. We do not
          build user profiles. We do not have accounts, so we hold no names, no email addresses and
          no passwords.
        </p>
      </Section>

      <Section title="Payments">
        <p>
          Paid plans are not live yet. When they launch, payments will be handled by a third-party
          payment provider and card details will be processed by them, never by us. This page will
          be updated before that happens.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Because everything is stored on your own device, you are in direct control: clearing your
          browser data removes all of it. If you have a question about analytics data or anything
          else, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes we will update the date at the top of this page. Continuing to use{' '}
          {BRAND.name} after a change means you accept the updated policy.
        </p>
      </Section>
    </LegalPage>
  );
}

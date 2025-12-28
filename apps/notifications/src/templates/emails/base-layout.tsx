/**
 * Base Email Layout
 * Common wrapper for all notification emails
 */

import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Hr,
  Link,
} from '@react-email/components';
import * as React from 'react';

export interface BaseLayoutProps {
  preview: string;
  children: React.ReactNode;
  unsubscribeUrl?: string;
  companyName?: string;
}

export function BaseLayout({
  preview,
  children,
  unsubscribeUrl,
  companyName = 'CRM',
}: BaseLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {/* Header */}
          <Section style={styles.header}>
            <Text style={styles.logo}>{companyName}</Text>
          </Section>

          {/* Content */}
          <Section style={styles.content}>{children}</Section>

          {/* Footer */}
          <Hr style={styles.hr} />
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              This email was sent by {companyName}. If you have questions,
              please contact your administrator.
            </Text>
            {unsubscribeUrl && (
              <Text style={styles.footerText}>
                <Link href={unsubscribeUrl} style={styles.unsubscribeLink}>
                  Unsubscribe from these notifications
                </Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: '#f6f9fc',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
    margin: 0,
    padding: 0,
  },
  container: {
    backgroundColor: '#ffffff',
    margin: '0 auto',
    maxWidth: '600px',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: '#1a1a2e',
    padding: '24px',
    textAlign: 'center' as const,
  },
  logo: {
    color: '#ffffff',
    fontSize: '24px',
    fontWeight: 'bold',
    margin: 0,
  },
  content: {
    padding: '32px 24px',
  },
  hr: {
    borderColor: '#e6ebf1',
    margin: '0',
  },
  footer: {
    padding: '24px',
    backgroundColor: '#f6f9fc',
  },
  footerText: {
    color: '#8898aa',
    fontSize: '12px',
    lineHeight: '16px',
    margin: '4px 0',
    textAlign: 'center' as const,
  },
  unsubscribeLink: {
    color: '#8898aa',
    textDecoration: 'underline',
  },
};

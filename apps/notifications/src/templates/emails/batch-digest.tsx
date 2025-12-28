/**
 * Batch Digest Notification Template
 * Sent as a summary of multiple notifications
 */

import {
  Button,
  Heading,
  Section,
  Text,
  Row,
  Column,
  Hr,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: string;
  priority?: 'low' | 'medium' | 'high';
  viewUrl: string;
}

export interface BatchDigestProps {
  recipientName: string;
  periodLabel: string;
  notifications: NotificationItem[];
  viewAllUrl: string;
  totalCount: number;
  unsubscribeUrl?: string;
}

const priorityColors = {
  low: '#3498db',
  medium: '#f39c12',
  high: '#e74c3c',
};

const typeIcons: Record<string, string> = {
  'email.escalation': '📧',
  'deal.won': '🎉',
  'deal.lost': '📉',
  'task.assigned': '📋',
  'task.due': '⏰',
  'customer.created': '👤',
  'invoice.overdue': '💰',
  default: '🔔',
};

export function BatchDigest({
  recipientName,
  periodLabel,
  notifications,
  viewAllUrl,
  totalCount,
  unsubscribeUrl,
}: BatchDigestProps) {
  const displayedNotifications = notifications.slice(0, 5);
  const remainingCount = totalCount - displayedNotifications.length;

  return (
    <BaseLayout
      preview={`${totalCount} notifications from ${periodLabel}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>Your Notification Summary</Heading>

      <Text style={styles.greeting}>Hi {recipientName},</Text>

      <Text style={styles.text}>
        Here's a summary of your notifications from <strong>{periodLabel}</strong>.
      </Text>

      {/* Summary Stats */}
      <Section style={styles.statsBox}>
        <Text style={styles.statNumber}>{totalCount}</Text>
        <Text style={styles.statLabel}>Total Notifications</Text>
      </Section>

      {/* Notification List */}
      <Section style={styles.notificationList}>
        {displayedNotifications.map((notification, index) => (
          <React.Fragment key={notification.id}>
            {index > 0 && <Hr style={styles.divider} />}
            <Row style={styles.notificationItem}>
              <Column style={styles.iconColumn}>
                <Text style={styles.icon}>
                  {typeIcons[notification.type] || typeIcons.default}
                </Text>
              </Column>
              <Column style={styles.contentColumn}>
                <Text style={styles.notificationTitle}>
                  {notification.priority && (
                    <span
                      style={{
                        ...styles.priorityDot,
                        backgroundColor:
                          priorityColors[notification.priority] ||
                          priorityColors.medium,
                      }}
                    />
                  )}
                  {notification.title}
                </Text>
                <Text style={styles.notificationSummary}>
                  {notification.summary}
                </Text>
                <Text style={styles.notificationTime}>
                  {notification.timestamp}
                </Text>
              </Column>
              <Column style={styles.actionColumn}>
                <Button href={notification.viewUrl} style={styles.viewButton}>
                  View
                </Button>
              </Column>
            </Row>
          </React.Fragment>
        ))}
      </Section>

      {/* More Items */}
      {remainingCount > 0 && (
        <Text style={styles.moreText}>
          + {remainingCount} more notification{remainingCount > 1 ? 's' : ''}
        </Text>
      )}

      {/* View All Button */}
      <Section style={styles.buttonRow}>
        <Button href={viewAllUrl} style={styles.primaryButton}>
          View All Notifications
        </Button>
      </Section>
    </BaseLayout>
  );
}

const styles = {
  heading: {
    color: '#1a1a2e',
    fontSize: '24px',
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
    margin: '0 0 24px',
  },
  greeting: {
    color: '#333',
    fontSize: '16px',
    lineHeight: '24px',
    margin: '0 0 16px',
  },
  text: {
    color: '#333',
    fontSize: '16px',
    lineHeight: '24px',
    margin: '0 0 24px',
  },
  statsBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  statNumber: {
    color: '#ffffff',
    fontSize: '48px',
    fontWeight: 'bold' as const,
    margin: '0',
    lineHeight: '1',
  },
  statLabel: {
    color: '#8898aa',
    fontSize: '14px',
    textTransform: 'uppercase' as const,
    margin: '8px 0 0',
  },
  notificationList: {
    backgroundColor: '#f6f9fc',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
  },
  notificationItem: {
    padding: '12px 0',
  },
  iconColumn: {
    width: '40px',
    verticalAlign: 'top' as const,
  },
  icon: {
    fontSize: '20px',
    margin: 0,
  },
  contentColumn: {
    verticalAlign: 'top' as const,
  },
  notificationTitle: {
    color: '#1a1a2e',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    margin: '0 0 4px',
  },
  priorityDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginRight: '8px',
  },
  notificationSummary: {
    color: '#555',
    fontSize: '13px',
    lineHeight: '18px',
    margin: '0 0 4px',
  },
  notificationTime: {
    color: '#8898aa',
    fontSize: '12px',
    margin: 0,
  },
  actionColumn: {
    width: '60px',
    verticalAlign: 'middle' as const,
    textAlign: 'right' as const,
  },
  viewButton: {
    backgroundColor: 'transparent',
    border: '1px solid #1a1a2e',
    borderRadius: '4px',
    color: '#1a1a2e',
    fontSize: '12px',
    textDecoration: 'none',
    padding: '6px 12px',
  },
  divider: {
    borderColor: '#e6ebf1',
    margin: 0,
  },
  moreText: {
    color: '#8898aa',
    fontSize: '14px',
    textAlign: 'center' as const,
    margin: '0 0 24px',
  },
  buttonRow: {
    textAlign: 'center' as const,
  },
  primaryButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    textAlign: 'center' as const,
    padding: '12px 24px',
  },
};

export default BatchDigest;

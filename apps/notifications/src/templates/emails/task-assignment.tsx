/**
 * Task Assignment Notification Template
 * Sent when a task is assigned to a user
 */

import {
  Button,
  Heading,
  Section,
  Text,
  Row,
  Column,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

export interface TaskAssignmentProps {
  recipientName: string;
  taskTitle: string;
  taskDescription?: string;
  assignedBy: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  relatedTo?: string;
  relatedType?: string;
  viewUrl: string;
  completeUrl?: string;
  unsubscribeUrl?: string;
}

const priorityColors = {
  low: '#3498db',
  medium: '#f39c12',
  high: '#e74c3c',
};

const priorityLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function TaskAssignment({
  recipientName,
  taskTitle,
  taskDescription,
  assignedBy,
  dueDate,
  priority,
  relatedTo,
  relatedType,
  viewUrl,
  completeUrl,
  unsubscribeUrl,
}: TaskAssignmentProps) {
  const priorityColor = priorityColors[priority] || priorityColors.medium;
  const priorityLabel = priorityLabels[priority] || priority;

  return (
    <BaseLayout
      preview={`New task assigned: ${taskTitle}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>New Task Assigned</Heading>

      <Text style={styles.greeting}>Hi {recipientName},</Text>

      <Text style={styles.text}>
        <strong>{assignedBy}</strong> has assigned you a new task.
      </Text>

      {/* Task Details */}
      <Section style={styles.detailsBox}>
        <Row>
          <Column>
            <Text style={styles.taskTitle}>{taskTitle}</Text>
          </Column>
        </Row>

        {taskDescription && (
          <Row>
            <Column>
              <Text style={styles.description}>{taskDescription}</Text>
            </Column>
          </Row>
        )}

        <Row>
          <Column>
            <Text style={styles.label}>Priority</Text>
            <Section
              style={{ ...styles.priorityBadge, backgroundColor: priorityColor }}
            >
              <Text style={styles.priorityText}>{priorityLabel}</Text>
            </Section>
          </Column>
          {dueDate && (
            <Column>
              <Text style={styles.label}>Due Date</Text>
              <Text style={styles.value}>{dueDate}</Text>
            </Column>
          )}
        </Row>

        {relatedTo && (
          <Row>
            <Column>
              <Text style={styles.label}>Related To</Text>
              <Text style={styles.value}>
                {relatedType && `${relatedType}: `}
                {relatedTo}
              </Text>
            </Column>
          </Row>
        )}
      </Section>

      {/* Action Buttons */}
      <Section style={styles.buttonRow}>
        <Row>
          <Column align="center">
            <Button href={viewUrl} style={styles.primaryButton}>
              View Task
            </Button>
          </Column>
          {completeUrl && (
            <Column align="center">
              <Button href={completeUrl} style={styles.completeButton}>
                Mark Complete
              </Button>
            </Column>
          )}
        </Row>
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
  detailsBox: {
    backgroundColor: '#f6f9fc',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '24px',
    borderLeft: '4px solid #1a1a2e',
  },
  taskTitle: {
    color: '#1a1a2e',
    fontSize: '18px',
    fontWeight: 'bold' as const,
    margin: '0 0 12px',
  },
  description: {
    color: '#555',
    fontSize: '14px',
    lineHeight: '20px',
    margin: '0 0 16px',
  },
  label: {
    color: '#8898aa',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    textTransform: 'uppercase' as const,
    margin: '0 0 4px',
  },
  value: {
    color: '#1a1a2e',
    fontSize: '14px',
    margin: '0 0 12px',
  },
  priorityBadge: {
    borderRadius: '4px',
    padding: '4px 8px',
    display: 'inline-block',
    marginBottom: '12px',
  },
  priorityText: {
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    margin: 0,
    textTransform: 'uppercase' as const,
  },
  buttonRow: {
    textAlign: 'center' as const,
  },
  primaryButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    padding: '10px 20px',
    marginRight: '8px',
  },
  completeButton: {
    backgroundColor: '#27ae60',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    padding: '10px 20px',
    marginLeft: '8px',
  },
};

export default TaskAssignment;

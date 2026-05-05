/**
 * Task Assignment Email Template
 * Sent when an escalation (task) is assigned to a user
 */

import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Tailwind,
} from "@react-email/components";
import * as React from "react";

export type TaskSignalCategory = 'negative' | 'upsell' | 'churn';

export interface TaskAssignedTask {
  id: string;
  customer: string;
  subject: string;
  dateOpened: string;
  assignedTo: string;
  assignedBy?: string | null;
  accountOwner: string;
  detailsUrl: string;
  signalCategory?: TaskSignalCategory;
}

export interface TaskAssignedEmailProps {
  task: TaskAssignedTask;
  recipientName?: string;
}

const HEADING_BY_CATEGORY: Record<TaskSignalCategory, string> = {
  negative: 'Escalation Assigned to You',
  upsell: 'Upsell Opportunity Assigned to You',
  churn: 'Churn Risk Assigned to You',
};

const NOUN_BY_CATEGORY: Record<TaskSignalCategory, string> = {
  negative: 'escalation',
  upsell: 'upsell opportunity',
  churn: 'churn risk',
};

const CTA_BY_CATEGORY: Record<TaskSignalCategory, string> = {
  negative: 'View Escalation',
  upsell: 'View Opportunity',
  churn: 'View Churn Risk',
};

export function TaskAssignedEmail({
  task,
  recipientName,
}: TaskAssignedEmailProps) {
  const isSystemAssigned = !task.assignedBy;
  const category: TaskSignalCategory = task.signalCategory ?? 'negative';
  const heading = HEADING_BY_CATEGORY[category];
  const noun = NOUN_BY_CATEGORY[category];
  const cta = CTA_BY_CATEGORY[category];
  const previewText = `New ${noun} assigned: ${task.customer} - ${task.subject}`;

  const isSamePerson = (a: string | null | undefined, b: string | null | undefined) =>
    a && b && a.toLowerCase().trim() === b.toLowerCase().trim();

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container
            className="bg-white mx-auto my-10 max-w-[540px] rounded-xl overflow-hidden"
            style={{ border: '1px solid #e4e4e7' }}
          >
            {/* Header */}
            <Section className="bg-zinc-900 px-8 py-7">
              <Text className="text-blue-400 text-xs font-medium uppercase tracking-wider m-0 mb-2">
                New Assignment
              </Text>
              <Text className="text-white text-[22px] font-semibold m-0">
                {heading}
              </Text>
            </Section>

            {/* Content */}
            <Section className="px-8 py-7">
              <Text className="text-sm text-zinc-600 m-0 mb-5">
                Hi {recipientName}, {isSystemAssigned
                  ? `you've been auto-assigned a new ${noun}.`
                  : `you've been assigned a new ${noun} by ${task.assignedBy}.`}
              </Text>

              {/* Task Card */}
              <div className="block no-underline p-5 rounded-lg bg-zinc-50 border border-zinc-200">
                <Text className="text-lg font-semibold text-zinc-900 m-0 mb-1">
                  {task.customer}
                </Text>
                <Text className="text-[15px] text-zinc-600 m-0 mb-4 leading-snug">
                  {task.subject}
                </Text>

                {/* Details Grid */}
                <table width="100%" cellPadding={0} cellSpacing={0}>
                  <tr>
                    <td width="50%" valign="top" style={{ paddingRight: "12px" }}>
                      <Text className="text-[10px] text-zinc-400 uppercase tracking-wide m-0 mb-1">
                        Opened
                      </Text>
                      <Text className="text-sm text-zinc-700 font-medium m-0">
                        {task.dateOpened}
                      </Text>
                    </td>
                    <td width="50%" valign="top" style={{ paddingLeft: "12px" }}>
                      <Text className="text-[10px] text-zinc-400 uppercase tracking-wide m-0 mb-1">
                        Assigned By
                      </Text>
                      <Text className="text-sm text-zinc-700 font-medium m-0">
                        {isSystemAssigned ? (
                          <span className="text-zinc-400 italic">Auto-assigned</span>
                        ) : (
                          task.assignedBy
                        )}
                      </Text>
                    </td>
                  </tr>
                  <tr>
                    <td
                      colSpan={2}
                      style={{ paddingTop: "12px" }}
                      valign="top"
                    >
                      <Text className="text-[10px] text-zinc-400 uppercase tracking-wide m-0 mb-1">
                        Account Owner
                      </Text>
                      <Text className="text-sm text-zinc-700 font-medium m-0">
                        {!isSystemAssigned && isSamePerson(task.assignedBy, task.accountOwner)
                          ? `${task.accountOwner} (Assigner)`
                          : task.accountOwner}
                      </Text>
                    </td>
                  </tr>
                </table>
              </div>

              {/* CTA Button */}
              <Section className="mt-6 mb-2 text-center">
                <Link
                  href={task.detailsUrl}
                  className="inline-block bg-zinc-900 text-white text-sm font-medium px-6 py-3 rounded-lg no-underline"
                >
                  {cta}
                </Link>
              </Section>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default TaskAssignedEmail;

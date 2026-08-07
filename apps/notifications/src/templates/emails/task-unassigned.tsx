/**
 * Task Unassignment Email Template
 * Sent when an escalation (task) is removed from a user.
 *
 * Deliberately has no "View Escalation" link. Being assigned is one of the two
 * ways a user reaches an escalation (the other is access to its customer), so
 * for an assignee outside the customer's team this notification arrives at the
 * exact moment the escalation stops being reachable — a link would 404 for
 * precisely the people who most need to be told. The customer and subject are
 * spelled out instead, so they know what left their queue.
 */

import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Tailwind,
} from "@react-email/components";
import * as React from "react";

export interface TaskUnassignedTask {
  id: string;
  customer: string;
  subject: string;
  dateOpened: string;
  removedBy?: string | null;
  /** Who holds it now; null when it was left unassigned. */
  reassignedTo?: string | null;
}

export interface TaskUnassignedEmailProps {
  task: TaskUnassignedTask;
  recipientName?: string;
}

export function TaskUnassignedEmail({
  task,
  recipientName,
}: TaskUnassignedEmailProps) {
  const handedOver = Boolean(task.reassignedTo);
  const previewText = handedOver
    ? `Escalation reassigned: ${task.customer} - ${task.subject}`
    : `Escalation removed: ${task.customer} - ${task.subject}`;

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
              <Text className="text-zinc-400 text-xs font-medium uppercase tracking-wider m-0 mb-2">
                {handedOver ? "Reassigned" : "Assignment Removed"}
              </Text>
              <Text className="text-white text-[22px] font-semibold m-0">
                No Longer Assigned to You
              </Text>
            </Section>

            {/* Content */}
            <Section className="px-8 py-7">
              <Text className="text-sm text-zinc-600 m-0 mb-5">
                Hi {recipientName},{" "}
                {handedOver
                  ? task.removedBy
                    ? `${task.removedBy} reassigned this escalation to ${task.reassignedTo}.`
                    : `this escalation has been reassigned to ${task.reassignedTo}.`
                  : task.removedBy
                    ? `${task.removedBy} removed this escalation from you.`
                    : "this escalation is no longer assigned to you."}{" "}
                No action is needed from you on it.
              </Text>

              {/* Task Card */}
              <div className="block p-5 rounded-lg bg-zinc-50 border border-zinc-200">
                <Text className="text-lg font-semibold text-zinc-900 m-0 mb-1">
                  {task.customer}
                </Text>
                <Text className="text-[15px] text-zinc-600 m-0 mb-4 leading-snug">
                  {task.subject}
                </Text>

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
                        {handedOver ? "Now Assigned To" : "Removed By"}
                      </Text>
                      <Text className="text-sm text-zinc-700 font-medium m-0">
                        {(handedOver ? task.reassignedTo : task.removedBy) ?? (
                          <span className="text-zinc-400 italic">Unknown</span>
                        )}
                      </Text>
                    </td>
                  </tr>
                </table>
              </div>

              <Text className="text-xs text-zinc-400 m-0 mt-5">
                If you were working on this, hand your notes to{" "}
                {handedOver ? task.reassignedTo : task.removedBy ?? "your manager"} —
                it may no longer appear in your escalations list.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default TaskUnassignedEmail;

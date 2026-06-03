import {
  BALevel,
  BAStatus,
  BookingPriority,
  BookingStatus,
  PrismaClient,
  SkillTagGroup,
  SkillTagStatus,
  UserRole
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const localDevDatabaseUrl =
  'postgresql://ba_bazaar:change_me@localhost:5433/ba_bazaar?schema=public';

process.env.DATABASE_URL ??= localDevDatabaseUrl;

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL
  })
});

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.privateNote.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.bASkillTag.deleteMany();
  await prisma.skillTag.deleteMany();
  await prisma.project.deleteMany();
  await prisma.bAProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await resetDatabase();

  const manager = await prisma.user.create({
    data: {
      full_name: 'Mai Lan Anh',
      email: 'lan.anh.manager@ba-bazaar.local',
      role: UserRole.BA_MANAGER,
      avatar_url: 'https://api.dicebear.com/9.x/initials/svg?seed=Mai%20Lan%20Anh'
    }
  });

  const pmUsers = await Promise.all(
    ['Minh Tran', 'Hoa Nguyen', 'Quang Pham', 'Linh Do', 'Khanh Vo'].map(
      (name, index) =>
        prisma.user.create({
          data: {
            full_name: name,
            email: `pm${index + 1}@ba-bazaar.local`,
            role: UserRole.PM_PO,
            avatar_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`
          }
        })
    )
  );

  const tagInputs = [
    ['Fintech', SkillTagGroup.DOMAIN],
    ['E-commerce', SkillTagGroup.DOMAIN],
    ['Logistics', SkillTagGroup.DOMAIN],
    ['HR Tech', SkillTagGroup.DOMAIN],
    ['CRM', SkillTagGroup.DOMAIN],
    ['BPMN', SkillTagGroup.ANALYSIS_SKILL],
    ['User Story Mapping', SkillTagGroup.ANALYSIS_SKILL],
    ['Data Analysis', SkillTagGroup.ANALYSIS_SKILL],
    ['API Specification', SkillTagGroup.ANALYSIS_SKILL],
    ['Stakeholder Workshop', SkillTagGroup.ANALYSIS_SKILL]
  ] as const;

  const tags = await Promise.all(
    tagInputs.map(([name, group]) =>
      prisma.skillTag.create({
        data: {
          name,
          group,
          status: SkillTagStatus.ACTIVE
        }
      })
    )
  );
  const tagByName = new Map(tags.map((tag) => [tag.name, tag]));

  const projects = await Promise.all(
    [
      ['Payment Refund Flow', '#2563EB', 'Refund and reconciliation workflow'],
      ['Mobile Onboarding', '#16A34A', 'Digital onboarding for mobile users'],
      ['CRM Revamp', '#7C3AED', 'Internal CRM modernization'],
      ['Logistics Tracking', '#F97316', 'Shipment tracking and exception flows'],
      ['BI Dashboard', '#0F766E', 'Executive utilization and delivery dashboard'],
      ['HR Approval Workflow', '#DB2777', 'People operation request approvals']
    ].map(([name, color, description]) =>
      prisma.project.create({
        data: {
          name,
          color,
          description
        }
      })
    )
  );

  const baInputs = [
    ['Pham Ngoc Chi', BALevel.SENIOR, BAStatus.ACTIVE, ['Fintech', 'BPMN', 'API Specification']],
    ['Do Anh Dung', BALevel.MIDDLE, BAStatus.ACTIVE, ['Logistics', 'Data Analysis']],
    ['Nguyen Bao An', BALevel.JUNIOR, BAStatus.ACTIVE, ['HR Tech', 'User Story Mapping']],
    ['Le Dang Khoa', BALevel.MIDDLE, BAStatus.ACTIVE, ['CRM', 'Stakeholder Workshop']],
    ['Bui Phuong Thao', BALevel.SENIOR, BAStatus.ACTIVE, ['CRM', 'Data Analysis']],
    ['Hoang Minh Chau', BALevel.LEAD, BAStatus.ACTIVE, ['Fintech', 'CRM', 'BPMN']],
    ['Tran Gia Huy', BALevel.MIDDLE, BAStatus.ACTIVE, ['E-commerce', 'API Specification']],
    ['Vo Thanh Tam', BALevel.SENIOR, BAStatus.ACTIVE, ['Logistics', 'BPMN']],
    ['Dang Thu Ha', BALevel.JUNIOR, BAStatus.ACTIVE, ['CRM', 'User Story Mapping']],
    ['Nguyen Mai Linh', BALevel.MIDDLE, BAStatus.ACTIVE, ['Fintech', 'Data Analysis']],
    ['Pham Quoc Bao', BALevel.SENIOR, BAStatus.ACTIVE, ['E-commerce', 'Stakeholder Workshop']],
    ['Do Minh Tue', BALevel.MIDDLE, BAStatus.ACTIVE, ['HR Tech', 'BPMN']],
    ['Le Hoai Nam', BALevel.LEAD, BAStatus.ON_LEAVE, ['CRM', 'API Specification']],
    ['Vu Nhat Vy', BALevel.SENIOR, BAStatus.ON_LEAVE, ['Fintech', 'Data Analysis']],
    ['Tran Thai Son', BALevel.MIDDLE, BAStatus.RESIGNED, ['Logistics', 'BPMN']]
  ] as const;

  const bas = [];
  for (const [index, [name, level, status, tagNames]] of baInputs.entries()) {
    const user = await prisma.user.create({
      data: {
        full_name: name,
        email: `ba${index + 1}@ba-bazaar.local`,
        role: UserRole.BA,
        avatar_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`
      }
    });

    const ba = await prisma.bAProfile.create({
      data: {
        user_id: user.id,
        full_name: name,
        email: user.email,
        phone: `090${String(index + 1).padStart(7, '0')}`,
        level,
        joined_date: date(`202${Math.min(index % 5, 5)}-0${(index % 8) + 1}-15`),
        avatar_url: user.avatar_url,
        status,
        status_reason:
          status === BAStatus.ON_LEAVE
            ? 'Temporary leave'
            : status === BAStatus.RESIGNED
              ? 'Historical profile retained'
              : null,
        status_changed_at: status === BAStatus.ACTIVE ? null : date('2026-05-20')
      }
    });

    for (const tagName of tagNames) {
      const tag = tagByName.get(tagName);
      if (!tag) {
        continue;
      }

      await prisma.bASkillTag.create({
        data: {
          ba_id: ba.id,
          tag_id: tag.id,
          assigned_by: manager.id
        }
      });
    }

    bas.push(ba);
  }

  const projectByName = new Map(projects.map((project) => [project.name, project]));

  const bookingInputs = [
    [0, 'Payment Refund Flow', 0, 'Refund analysis sprint', '2026-06-01', '2026-06-05', 50, BookingStatus.APPROVED, BookingPriority.HIGH],
    [0, 'CRM Revamp', 1, 'Pending CRM dependency mapping', '2026-06-03', '2026-06-06', 50, BookingStatus.PENDING, BookingPriority.MEDIUM],
    [1, 'Logistics Tracking', 1, 'Shipment exception flow', '2026-06-01', '2026-06-06', 100, BookingStatus.APPROVED, BookingPriority.HIGH],
    [2, 'HR Approval Workflow', 2, 'HR request rules', '2026-06-03', '2026-06-04', 100, BookingStatus.APPROVED, BookingPriority.LOW],
    [4, 'BI Dashboard', 3, 'Dashboard requirements', '2026-06-01', '2026-06-05', 50, BookingStatus.APPROVED, BookingPriority.MEDIUM],
    [4, 'Internal Portal', 4, 'Portal request risk', '2026-06-01', '2026-06-06', 100, BookingStatus.PENDING, BookingPriority.URGENT],
    [5, 'CRM Revamp', 0, 'Lead BA CRM review', '2026-06-02', '2026-06-07', 100, BookingStatus.IN_PROGRESS, BookingPriority.HIGH],
    [6, 'Mobile Onboarding', 1, 'Onboarding discovery', '2026-06-09', '2026-06-13', 50, BookingStatus.PENDING, BookingPriority.MEDIUM],
    [7, 'Logistics Tracking', 2, 'Carrier integration analysis', '2026-06-10', '2026-06-14', 50, BookingStatus.APPROVED, BookingPriority.HIGH],
    [8, 'CRM Revamp', 3, 'Customer profile grooming', '2026-06-09', '2026-06-10', 100, BookingStatus.REJECTED, BookingPriority.LOW],
    [10, 'BI Dashboard', 1, 'Completed onboarding metric wrap-up', '2026-06-02', '2026-06-03', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'Internal Portal', 1, 'Portal backlog walkthrough', '2026-05-21', '2026-05-23', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'BI Dashboard', 4, 'CRM metrics mapping', '2026-05-12', '2026-05-16', 50, BookingStatus.COMPLETED, BookingPriority.HIGH],
    [8, 'Payment Refund Flow', 0, 'Refund contact-center scenarios', '2026-04-22', '2026-04-25', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'Mobile Onboarding', 2, 'Onboarding support fallback', '2026-04-08', '2026-04-10', 50, BookingStatus.CANCELLED, BookingPriority.LOW],
    [8, 'HR Approval Workflow', 1, 'Policy intake notes', '2026-03-17', '2026-03-20', 50, BookingStatus.COMPLETED, BookingPriority.LOW],
    [8, 'CRM Revamp', 0, 'Legacy contact merge review', '2026-02-10', '2026-02-13', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'Logistics Tracking', 2, 'Returned-order exception analysis', '2026-01-19', '2026-01-23', 100, BookingStatus.COMPLETED, BookingPriority.HIGH],
    [8, 'Payment Refund Flow', 4, 'Refund SLA gap mapping', '2025-12-08', '2025-12-12', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'BI Dashboard', 3, 'Retention metrics workshop', '2025-11-17', '2025-11-21', 100, BookingStatus.COMPLETED, BookingPriority.HIGH],
    [8, 'Internal Portal', 1, 'Service request taxonomy cleanup', '2025-10-06', '2025-10-10', 50, BookingStatus.COMPLETED, BookingPriority.LOW],
    [8, 'CRM Revamp', 0, 'Lead intake form simplification', '2025-09-15', '2025-09-19', 100, BookingStatus.COMPLETED, BookingPriority.HIGH],
    [8, 'HR Approval Workflow', 4, 'Escalation ladder discovery', '2025-08-11', '2025-08-15', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'Mobile Onboarding', 2, 'Activation funnel notes', '2025-07-07', '2025-07-11', 100, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [8, 'Payment Refund Flow', 3, 'Refund reasons catalog', '2025-06-09', '2025-06-13', 50, BookingStatus.COMPLETED, BookingPriority.LOW],
    [8, 'BI Dashboard', 1, 'Customer health score definition', '2025-05-12', '2025-05-16', 100, BookingStatus.COMPLETED, BookingPriority.HIGH],
    [8, 'CRM Revamp', 4, 'Duplicate profile cleanup rules', '2025-04-14', '2025-04-18', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [9, 'Payment Refund Flow', 4, 'Refund report review', '2026-06-11', '2026-06-15', 50, BookingStatus.APPROVED, BookingPriority.MEDIUM],
    [10, 'Mobile Onboarding', 0, 'KYC rules', '2026-06-16', '2026-06-20', 100, BookingStatus.PENDING, BookingPriority.URGENT],
    [11, 'HR Approval Workflow', 1, 'Approval matrix', '2026-06-16', '2026-06-18', 50, BookingStatus.APPROVED, BookingPriority.MEDIUM],
    [0, 'Payment Refund Flow', 2, 'Completed refund baseline', '2026-05-04', '2026-05-08', 50, BookingStatus.COMPLETED, BookingPriority.MEDIUM],
    [1, 'Logistics Tracking', 3, 'Cancelled logistics support', '2026-05-11', '2026-05-13', 50, BookingStatus.CANCELLED, BookingPriority.LOW],
    [2, 'HR Approval Workflow', 4, 'Completed HR interviews', '2026-05-18', '2026-05-22', 100, BookingStatus.COMPLETED, BookingPriority.HIGH],
    [3, 'CRM Revamp', 0, 'Free-capacity pending demo', '2026-06-04', '2026-06-10', 50, BookingStatus.PENDING, BookingPriority.HIGH],
    [5, 'BI Dashboard', 1, 'Approved full capacity block', '2026-06-10', '2026-06-14', 100, BookingStatus.APPROVED, BookingPriority.URGENT],
    [5, 'Mobile Onboarding', 2, 'Should be blocked if approved', '2026-06-11', '2026-06-12', 50, BookingStatus.PENDING, BookingPriority.HIGH],
    [12, 'CRM Revamp', 3, 'Historical on-leave booking', '2026-05-01', '2026-05-03', 50, BookingStatus.COMPLETED, BookingPriority.LOW],
    [14, 'Logistics Tracking', 4, 'Historical resigned BA booking', '2026-04-01', '2026-04-05', 100, BookingStatus.COMPLETED, BookingPriority.MEDIUM]
  ] as const;

  const createdBookings = [];
  for (const [
    baIndex,
    projectName,
    requesterIndex,
    title,
    startDate,
    endDate,
    capacityPercent,
    status,
    priority
  ] of bookingInputs) {
    const project = projectByName.get(projectName) ?? projects[0];
    const approved = [
      BookingStatus.APPROVED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED
    ].includes(status);
    const rejected = status === BookingStatus.REJECTED;
    const cancelled = status === BookingStatus.CANCELLED;

    const booking = await prisma.booking.create({
      data: {
        ba_id: bas[baIndex].id,
        project_id: project.id,
        requester_id: pmUsers[requesterIndex].id,
        manager_id: approved || rejected || cancelled ? manager.id : null,
        title,
        description: `${title} for ${projectName}.`,
        start_date: date(startDate),
        end_date: date(endDate),
        capacity_percent: capacityPercent,
        priority,
        status,
        reject_reason: rejected ? 'BA has conflicting priority work in this period.' : null,
        cancel_reason: cancelled ? 'Project scope changed before kickoff.' : null,
        manager_comment: approved ? 'Approved in seed data.' : null,
        approved_at: approved ? date(startDate) : null,
        rejected_at: rejected ? date('2026-06-01') : null,
        cancelled_at: cancelled ? date('2026-05-10') : null
      }
    });
    createdBookings.push(booking);
  }

  const inboxFocusedBookings = [
    {
      ba_id: bas[4].id,
      project_id: (projectByName.get('Payment Refund Flow') ?? projects[0]).id,
      requester_id: pmUsers[4].id,
      title: 'Payment Refund Flow',
      description: 'Portal request for failed refunds and validation updates.',
      notes: 'Requested BA: Bui Phuong Thao',
      start_date: date('2026-06-01'),
      end_date: date('2026-06-05'),
      capacity_percent: 100,
      priority: BookingPriority.URGENT,
      status: BookingStatus.PENDING
    },
    {
      ba_id: null,
      project_id: (projectByName.get('CRM Revamp') ?? projects[0]).id,
      requester_id: pmUsers[1].id,
      title: 'CRM Revamp',
      description: 'Open request for dependency mapping and BA assignment.',
      notes: 'BA not assigned yet.',
      start_date: date('2026-06-03'),
      end_date: date('2026-06-06'),
      capacity_percent: 50,
      priority: BookingPriority.MEDIUM,
      status: BookingStatus.PENDING
    },
    {
      ba_id: null,
      project_id: (projectByName.get('Mobile Onboarding') ?? projects[0]).id,
      requester_id: pmUsers[3].id,
      title: 'Mobile Onboarding',
      description: 'Open request for onboarding workstream alignment.',
      notes: '[VERIFY] Needs manager verification before BA assignment.',
      start_date: date('2026-06-05'),
      end_date: date('2026-06-12'),
      capacity_percent: 100,
      priority: BookingPriority.MEDIUM,
      status: BookingStatus.PENDING
    },
    {
      ba_id: bas[3].id,
      project_id: (projectByName.get('CRM Revamp') ?? projects[0]).id,
      requester_id: pmUsers[0].id,
      title: 'Reporting Portal Upgrade',
      description: 'Specific BA request for portal reporting enhancements.',
      notes: 'Requested BA: Le Dang Khoa',
      start_date: date('2026-06-07'),
      end_date: date('2026-06-11'),
      capacity_percent: 50,
      priority: BookingPriority.MEDIUM,
      status: BookingStatus.PENDING
    },
    {
      ba_id: bas[9].id,
      project_id: (projectByName.get('BI Dashboard') ?? projects[0]).id,
      requester_id: pmUsers[2].id,
      title: 'Data Warehouse Redesign',
      description: 'Specific BA request for reporting model redesign.',
      notes: 'Requested BA: Nguyen Mai Linh',
      start_date: date('2026-06-08'),
      end_date: date('2026-06-13'),
      capacity_percent: 50,
      priority: BookingPriority.HIGH,
      status: BookingStatus.PENDING
    },
    {
      ba_id: null,
      project_id: (projectByName.get('BI Dashboard') ?? projects[0]).id,
      requester_id: pmUsers[2].id,
      title: 'Analytics Dashboard',
      description: 'Open request for analytics dashboard discovery.',
      notes: 'Needs BA assignment.',
      start_date: date('2026-06-09'),
      end_date: date('2026-06-13'),
      capacity_percent: 50,
      priority: BookingPriority.HIGH,
      status: BookingStatus.PENDING
    }
  ] as const;

  for (const input of inboxFocusedBookings) {
    const booking = await prisma.booking.create({
      data: {
        ...input,
        manager_id: null
      }
    });
    createdBookings.push(booking);
  }

  for (const [index, content] of [
    'Strong stakeholder facilitation, good fit for discovery-heavy work.',
    'Prefers clear acceptance criteria before sprint planning.',
    'Recently mentored junior BA on BPMN modeling.',
    'Watch workload near quarter end due reporting commitments.',
    'Good candidate for API-heavy projects.'
  ].entries()) {
    await prisma.privateNote.create({
      data: {
        ba_id: bas[index].id,
        content,
        created_by: manager.id
      }
    });
  }

  await prisma.notification.createMany({
    data: [
      {
        recipient_id: manager.id,
        type: 'BOOKING_REQUEST_CREATED',
        title: 'New booking request',
        message: 'A pending request needs review.',
        related_entity_type: 'Booking',
        related_entity_id: createdBookings[1].id
      },
      {
        recipient_id: pmUsers[0].id,
        type: 'BOOKING_APPROVED',
        title: 'Booking approved',
        message: 'Your request for Payment Refund Flow was approved.',
        related_entity_type: 'Booking',
        related_entity_id: createdBookings[0].id
      },
      {
        recipient_id: pmUsers[3].id,
        type: 'BOOKING_REJECTED',
        title: 'Booking rejected',
        message: 'Your CRM request was rejected with a manager reason.',
        related_entity_type: 'Booking',
        related_entity_id: createdBookings[9].id
      }
    ]
  });

  await prisma.auditLog.create({
    data: {
      actor_id: manager.id,
      action: 'SEED_DATABASE',
      target_type: 'Database',
      target_id: manager.id,
      result: 'SUCCESS',
      new_value: {
        users: 21,
        ba_profiles: 15,
        bookings: createdBookings.length
      }
    }
  });

  console.log('Seed completed', {
    users: 21,
    baProfiles: bas.length,
    pmPoUsers: pmUsers.length,
    projects: projects.length,
    tags: tags.length,
    bookings: createdBookings.length
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

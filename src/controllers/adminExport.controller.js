/**
 * Admin CSV exports.
 *
 * One home for the "Export to Excel" endpoints of the admin list pages, so the
 * export logic is discoverable in a single place instead of being scattered
 * across inline route handlers in admin.routes.js.
 *
 * Wallet and withdrawal exports live in adminWallet.controller.js next to the
 * list endpoints whose filters they share.
 *
 * Conventions every export here follows:
 *  - Same filters as the matching list endpoint, so the sheet matches the screen.
 *  - Every row matching the filters, NOT just the current page.
 *  - Capped at DEFAULT_EXPORT_LIMIT rows; `truncated` is recorded in the audit log.
 *  - `search` is only honoured where the list endpoint filters at the DB level.
 *    Where the list filters in memory after pagination it cannot be reproduced
 *    over the full set, and is documented as ignored on that endpoint.
 */

const { User, Guest, Consultation, Review, LiveStream } = require('../models');
const ProfileEditLog = require('../models/ProfileEditLog.model');
const {
  DEFAULT_EXPORT_LIMIT,
  csvCell,
  csvTextCell,
  formatDateTime,
  money,
  buildDateRange,
  sendCsv,
  csvError,
} = require('../utils/csvExport');

// ─── Users / providers ───────────────────────────────────────────────────────
// Mirrors admin.controller.getAllProviders (DB-level search, so search IS applied).
// @route GET /api/admin/providers/export
const exportProviders = async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      role = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      startDate = null,
      endDate = null,
    } = req.query;

    const filter = {};
    if (role === 'provider') filter.isServiceProvider = true;
    else if (role === 'user') filter.isServiceProvider = false;
    if (status !== 'all') filter.status = status;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { profession: { $regex: search, $options: 'i' } },
      ];
    }
    const createdAt = buildDateRange(startDate, endDate);
    if (createdAt) filter.createdAt = createdAt;

    const users = await User.find(filter)
      .select('fullName email mobile profession place gender isServiceProvider status providerVerificationStatus wallet earnings totalSpent rating lastActive createdAt')
      .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    const headers = [
      'Joined (UTC)', 'User ID', 'Name', 'Mobile', 'Email', 'Role', 'Profession',
      'Place', 'Gender', 'Status', 'KYC Status', 'Wallet Balance', 'Total Earnings',
      'Total Spent', 'Rating', 'Rating Count', 'Last Active (UTC)',
    ];

    const rows = users.map((u) => [
      csvCell(formatDateTime(u.createdAt)),
      csvCell(String(u._id)),
      csvCell(u.fullName),
      csvCell(u.mobile),
      csvCell(u.email),
      csvCell(u.isServiceProvider ? 'Provider' : 'User'),
      csvCell(u.profession),
      csvCell(u.place),
      csvCell(u.gender),
      csvCell(u.status),
      csvCell(u.providerVerificationStatus),
      csvCell(money(u.wallet)),
      csvCell(money(u.earnings)),
      csvCell(money(u.totalSpent)),
      csvCell(u.rating?.average != null ? Number(u.rating.average).toFixed(2) : ''),
      csvCell(u.rating?.count),
      csvCell(formatDateTime(u.lastActive)),
    ].join(','));

    return sendCsv(res, {
      filename: 'users',
      suffix: role !== 'all' ? role : (status !== 'all' ? status : ''),
      headers,
      rows,
      req,
      audit: { filter, truncated: users.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'users', error);
  }
};

// ─── Guests ──────────────────────────────────────────────────────────────────
// Mirrors adminGuest.controller.getAllGuests (DB-level search).
// @route GET /api/admin/guests/export
const exportGuests = async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      sortBy = 'createdAt',
      sortOrder = 'desc',
      minWallet = null,
      maxWallet = null,
    } = req.query;

    const filter = {};
    if (status !== 'all') filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ];
    }
    if (minWallet) filter.wallet = { $gte: parseFloat(minWallet) };
    if (maxWallet) filter.wallet = { ...filter.wallet, $lte: parseFloat(maxWallet) };

    const guests = await Guest.find(filter)
      .select('name mobile wallet totalSpent status lastActive createdAt')
      .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    const headers = [
      'Joined (UTC)', 'Guest ID', 'Name', 'Mobile',
      'Wallet Balance', 'Total Spent', 'Status', 'Last Active (UTC)',
    ];

    const rows = guests.map((g) => [
      csvCell(formatDateTime(g.createdAt)),
      csvCell(String(g._id)),
      csvCell(g.name),
      csvCell(g.mobile),
      csvCell(money(g.wallet)),
      csvCell(money(g.totalSpent)),
      csvCell(g.status),
      csvCell(formatDateTime(g.lastActive)),
    ].join(','));

    return sendCsv(res, {
      filename: 'guests',
      suffix: status !== 'all' ? status : '',
      headers,
      rows,
      req,
      audit: { filter, truncated: guests.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'guests', error);
  }
};

// ─── KYC ─────────────────────────────────────────────────────────────────────
// Mirrors admin.controller.getKycRequests, including its $and/$or search combining.
// @route GET /api/admin/kyc/export
const exportKycRequests = async (req, res) => {
  try {
    const { status = 'all', search = '' } = req.query;

    const filter = {};
    if (status !== 'all') {
      filter.providerVerificationStatus = status;
    } else {
      filter.$or = [
        { isServiceProvider: true },
        { providerVerificationStatus: { $in: ['pending', 'verified', 'rejected'] } },
      ];
    }

    if (search) {
      const searchOr = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { aadharNumber: { $regex: search, $options: 'i' } },
      ];
      if (filter.$or) {
        const baseOr = filter.$or;
        delete filter.$or;
        filter.$and = [{ $or: baseOr }, { $or: searchOr }];
      } else {
        filter.$or = searchOr;
      }
    }

    const requests = await User.find(filter)
      .select('fullName email mobile profession place aadharNumber providerVerificationStatus verificationNotes verifiedAt verifiedBy aadharDocuments professionalCertificate createdAt')
      .populate('verifiedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    const headers = [
      'Submitted (UTC)', 'User ID', 'Name', 'Mobile', 'Email', 'Profession', 'Place',
      'Aadhar Number', 'KYC Status', 'Aadhar Docs', 'Certificate',
      'Verified At (UTC)', 'Verified By', 'Verification Notes',
    ];

    const rows = requests.map((u) => [
      csvCell(formatDateTime(u.createdAt)),
      csvCell(String(u._id)),
      csvCell(u.fullName),
      csvCell(u.mobile),
      csvCell(u.email),
      csvCell(u.profession),
      csvCell(u.place),
      // Aadhar is a long digit string: force text so Excel keeps it intact.
      csvTextCell(u.aadharNumber),
      csvCell(u.providerVerificationStatus),
      csvCell(Array.isArray(u.aadharDocuments) ? u.aadharDocuments.length : 0),
      csvCell(u.professionalCertificate ? 'Yes' : 'No'),
      csvCell(formatDateTime(u.verifiedAt)),
      csvCell(u.verifiedBy?.fullName),
      csvCell(u.verificationNotes),
    ].join(','));

    return sendCsv(res, {
      filename: 'kyc-requests',
      suffix: status !== 'all' ? status : '',
      headers,
      rows,
      req,
      audit: { filter, truncated: requests.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'KYC requests', error);
  }
};

// ─── Consultations ───────────────────────────────────────────────────────────
// Mirrors the GET /admin/consultations inline handler.
// NOTE: that endpoint filters `search` in memory AFTER pagination, so it cannot
// be reproduced over the full set — this export ignores search.
// @route GET /api/admin/consultations/export
const exportConsultations = async (req, res) => {
  try {
    const { status = 'all', type = 'all', startDate = null, endDate = null } = req.query;

    const filter = {};
    if (status !== 'all') filter.status = status;
    if (type !== 'all') filter.type = type;
    const createdAt = buildDateRange(startDate, endDate);
    if (createdAt) filter.createdAt = createdAt;

    const consultations = await Consultation.find(filter)
      .populate('provider', 'fullName mobile profession')
      .sort({ createdAt: -1 })
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    // `user` is Mixed (User or Guest), so resolve names in one batch per model
    // rather than per row.
    const userIds = consultations.filter((c) => c.userType !== 'Guest' && c.user).map((c) => String(c.user));
    const guestIds = consultations.filter((c) => c.userType === 'Guest' && c.user).map((c) => String(c.user));

    const [users, guests] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('fullName mobile').lean() : [],
      guestIds.length ? Guest.find({ _id: { $in: guestIds } }).select('name mobile').lean() : [],
    ]);

    const nameMap = {};
    users.forEach((u) => { nameMap[String(u._id)] = { name: u.fullName, mobile: u.mobile }; });
    guests.forEach((g) => { nameMap[String(g._id)] = { name: g.name, mobile: g.mobile }; });

    const headers = [
      'Created (UTC)', 'Consultation Ref', 'Internal ID', 'Type', 'Status',
      'Client Type', 'Client Name', 'Client Mobile',
      'Provider Name', 'Provider Mobile', 'Provider Profession',
      'Start (UTC)', 'End (UTC)', 'Billed Minutes', 'Rate/min', 'Total Amount',
      'End Reason', 'Conference', 'Rating',
    ];

    const rows = consultations.map((c) => {
      const client = nameMap[String(c.user)] || {};
      return [
        csvCell(formatDateTime(c.createdAt)),
        csvCell(c.consultationId),
        csvCell(String(c._id)),
        csvCell(c.type),
        csvCell(c.status),
        csvCell(c.userType === 'Guest' ? 'Guest' : 'User'),
        csvCell(client.name),
        csvCell(client.mobile),
        csvCell(c.provider?.fullName),
        csvCell(c.provider?.mobile),
        csvCell(c.provider?.profession),
        csvCell(formatDateTime(c.startTime)),
        csvCell(formatDateTime(c.endTime)),
        csvCell(c.duration),
        csvCell(money(c.rate)),
        csvCell(money(c.totalAmount)),
        csvCell(c.endReason),
        csvCell(c.isConference ? 'Yes' : 'No'),
        csvCell(c.rating?.stars),
      ].join(',');
    });

    return sendCsv(res, {
      filename: 'consultations',
      suffix: status !== 'all' ? status : (type !== 'all' ? type : ''),
      headers,
      rows,
      req,
      audit: { filter, truncated: consultations.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'consultations', error);
  }
};

// ─── Reviews ─────────────────────────────────────────────────────────────────
// Mirrors the GET /admin/reviews inline handler.
// NOTE: that endpoint filters `search` in memory AFTER pagination — ignored here.
// @route GET /api/admin/reviews/export
const exportReviews = async (req, res) => {
  try {
    const { status = 'all', rating = null, sortBy = 'newest' } = req.query;

    const filter = {};
    if (status !== 'all') filter.status = status;
    if (rating) filter.rating = parseInt(rating, 10);

    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      highRating: { rating: -1 },
      lowRating: { rating: 1 },
    };

    const reviews = await Review.find(filter)
      .populate('user', 'fullName mobile')
      .populate('provider', 'fullName mobile profession')
      .populate('consultation', 'consultationId type duration totalAmount')
      .sort(sortOptions[sortBy] || sortOptions.newest)
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    const headers = [
      'Date (UTC)', 'Review ID', 'Rating', 'Review', 'Tags', 'Status', 'Reported',
      'Report Reason', 'Reviewer', 'Reviewer Mobile',
      'Provider', 'Provider Mobile', 'Provider Profession',
      'Consultation Ref', 'Consultation Type', 'Duration (min)', 'Amount',
    ];

    const rows = reviews.map((r) => [
      csvCell(formatDateTime(r.createdAt)),
      csvCell(String(r._id)),
      csvCell(r.rating),
      csvCell(r.review),
      csvCell(Array.isArray(r.tags) ? r.tags.join('; ') : ''),
      csvCell(r.status),
      csvCell(r.isReported ? 'Yes' : 'No'),
      csvCell(r.reportReason),
      csvCell(r.user?.fullName),
      csvCell(r.user?.mobile),
      csvCell(r.provider?.fullName),
      csvCell(r.provider?.mobile),
      csvCell(r.provider?.profession),
      csvCell(r.consultation?.consultationId),
      csvCell(r.consultation?.type),
      csvCell(r.consultation?.duration),
      csvCell(money(r.consultation?.totalAmount)),
    ].join(','));

    return sendCsv(res, {
      filename: 'reviews',
      suffix: status !== 'all' ? status : '',
      headers,
      rows,
      req,
      audit: { filter, truncated: reviews.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'reviews', error);
  }
};

// ─── Live streams ────────────────────────────────────────────────────────────
// Mirrors the GET /admin/live-streams inline handler (which has no search).
// @route GET /api/admin/live-streams/export
const exportLiveStreams = async (req, res) => {
  try {
    const { status = 'all', startDate = null, endDate = null } = req.query;

    const filter = {};
    if (status === 'active') filter.isActive = true;
    else if (status === 'ended') filter.isActive = false;
    const createdAt = buildDateRange(startDate, endDate);
    if (createdAt) filter.createdAt = createdAt;

    const streams = await LiveStream.find(filter)
      .populate('streamer', 'fullName mobile profession')
      .sort({ createdAt: -1 })
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    const headers = [
      'Created (UTC)', 'Stream ID', 'Title', 'Streamer', 'Streamer Mobile',
      'Profession', 'Rate/min', 'Total Viewers', 'Peak Concurrent',
      'Total Earnings', 'Likes', 'Active', 'Started (UTC)', 'Ended (UTC)',
      'Duration (min)',
    ];

    const rows = streams.map((s) => {
      const durationMin = s.startedAt && s.endedAt
        ? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000)
        : '';
      return [
        csvCell(formatDateTime(s.createdAt)),
        csvCell(String(s._id)),
        csvCell(s.title),
        csvCell(s.streamer?.fullName),
        csvCell(s.streamer?.mobile),
        csvCell(s.streamer?.profession),
        csvCell(money(s.ratePerMinute)),
        csvCell(s.totalViewers),
        csvCell(s.maxConcurrentViewers),
        csvCell(money(s.totalEarnings)),
        csvCell(s.likes),
        csvCell(s.isActive ? 'Yes' : 'No'),
        csvCell(formatDateTime(s.startedAt)),
        csvCell(formatDateTime(s.endedAt)),
        csvCell(durationMin),
      ].join(',');
    });

    return sendCsv(res, {
      filename: 'live-streams',
      suffix: status !== 'all' ? status : '',
      headers,
      rows,
      req,
      audit: { filter, truncated: streams.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'live streams', error);
  }
};

// ─── Profile edit logs ───────────────────────────────────────────────────────
// Mirrors the GET /admin/profile-edits inline handler (DB-level search).
// One row per CHANGED FIELD rather than per log entry, since a log can carry
// several changes and a flat sheet is what makes it auditable.
// @route GET /api/admin/profile-edits/export
const exportProfileEdits = async (req, res) => {
  try {
    const { search = '', userId = null, startDate = null, endDate = null } = req.query;

    const filter = {};
    if (userId) filter.user = userId;
    if (search) {
      filter.$or = [
        { userName: { $regex: search, $options: 'i' } },
        { userMobile: { $regex: search, $options: 'i' } },
        { 'changes.field': { $regex: search, $options: 'i' } },
      ];
    }
    const createdAt = buildDateRange(startDate, endDate);
    if (createdAt) filter.createdAt = createdAt;

    const logs = await ProfileEditLog.find(filter)
      .populate('user', 'fullName mobile profession isServiceProvider')
      .sort({ createdAt: -1 })
      .limit(DEFAULT_EXPORT_LIMIT)
      .lean();

    const headers = [
      'Edited At (UTC)', 'Log ID', 'User ID', 'Name', 'Mobile', 'Role',
      'Field Changed', 'Old Value', 'New Value', 'IP',
    ];

    const rows = [];
    logs.forEach((log) => {
      const base = [
        csvCell(formatDateTime(log.createdAt)),
        csvCell(String(log._id)),
        csvCell(String(log.user?._id || log.user || '')),
        csvCell(log.user?.fullName || log.userName),
        csvCell(log.user?.mobile || log.userMobile),
        csvCell(log.user?.isServiceProvider ? 'Provider' : 'User'),
      ];

      const changes = Array.isArray(log.changes) && log.changes.length
        ? log.changes
        : [{ field: '', oldValue: '', newValue: '' }];

      changes.forEach((c) => {
        // Values can be objects/arrays; stringify so nothing is silently dropped.
        const asText = (v) =>
          v === null || v === undefined
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);
        rows.push([
          ...base,
          csvCell(c.field),
          csvCell(asText(c.oldValue ?? c.old)),
          csvCell(asText(c.newValue ?? c.new)),
          csvCell(log.ip),
        ].join(','));
      });
    });

    return sendCsv(res, {
      filename: 'profile-edits',
      headers,
      rows,
      req,
      audit: { filter, logs: logs.length, truncated: logs.length === DEFAULT_EXPORT_LIMIT },
    });
  } catch (error) {
    return csvError(res, 'profile edit logs', error);
  }
};

module.exports = {
  exportProviders,
  exportGuests,
  exportKycRequests,
  exportConsultations,
  exportReviews,
  exportLiveStreams,
  exportProfileEdits,
};

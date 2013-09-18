var when = require("when"),
    _ = require("underscore"),
    models = require('../../models'),
    errors = require('../../errorHandling'),
    TempImporter;


TempImporter = function () {
    _.bindAll(this, "basicImport");

    this.version = "003";

    this.importFrom = {
        "001": this.basicImport,
        "002": this.basicImport
    };
};

TempImporter.prototype.importData = function (data) {
    return this.canImport(data)
        .then(function (importerFunc) {
            return importerFunc(data);
        }, function (reason) {
            return when.reject(reason);
        });
};

TempImporter.prototype.canImport = function (data) {
    if (data.meta && data.meta.version && this.importFrom[data.meta.version]) {
        return when.resolve(this.importFrom[data.meta.version]);
    }

    return when.reject("Unsupported version of data");
};


function stripProperties(properties, data) {
    _.each(data, function (obj) {
        _.each(properties, function (property) {
            delete obj[property];
        });
    });
    return data;
}

function defaultProperty(obj, name, defaultVal) {
    if (!obj[name]) {
        obj[name] = defaultVal;
    }

    return obj;
}

function preProcessPostTags(tableData) {
    var postTags,
        postsWithTags = {};


    postTags = tableData.posts_tags;
    _.each(postTags, function (post_tag) {
        if (!postsWithTags.hasOwnProperty(post_tag.post_id)) {
            postsWithTags[post_tag.post_id] = [];
        }
        postsWithTags[post_tag.post_id].push(post_tag.tag_id);
    });

    _.each(postsWithTags, function (tag_ids, post_id) {
        var post, tags;
        post = _.find(tableData.posts, function (post) {
            return post.id === parseInt(post_id, 10);
        });
        if (post) {
            tags = _.filter(tableData.tags, function (tag) {
                return _.indexOf(tag_ids, tag.id) !== -1;
            });
            post.tags = [];
            _.each(tags, function (tag) {
                // names are unique.. this should get the right tags added
                // as long as tags are added first;
                post.tags.push({name: tag.name});
            });
        }
    });

    return tableData;
}

function importTags(ops, tableData) {
    tableData = stripProperties(['id', 'meta_keywords'], tableData);
    _.each(tableData, function (tag) {
        ops.push(models.Tag.add(tag));
    });
}

function importPosts(ops, tableData) {
    tableData = stripProperties(['id'], tableData);

    _.each(tableData, function (post) {
        post = defaultProperty(post, "language", "en_US");
        post = defaultProperty(post, "featured", false);
        post.page = false;
        post.markdown = post.content_raw;
        post.html = post.content;
        post.status = post.status || 'draft';
        post.created_by = post.created_by || 1;

        ops.push(models.Post.add(post));
    });
}

function importUsers(ops, tableData) {
    _.each(tableData, function (user) {
        user.name = user.full_name || 'Joe Bloggs';
        user.email = user.email_address;
        user.website = user.url;
        user.language = 'en_US';
        user.status = 'active';
        user.image = user.profile_picture;
        user.cover = user.cover_picture;
        user.created_by = user.created_by || 1;
    });

    tableData = stripProperties(['id', 'full_name', 'email_address', 'url'], tableData);
    tableData[0].id = 1;

    ops.push(models.User.edit(tableData[0]));
}

function importSettings(ops, tableData) {
    // for settings we need to update individual settings, and insert any missing ones
    // the one setting we MUST NOT update is the databaseVersion settings
    var blackList = ['databaseVersion', 'currentVersion', 'language', 'url'];
    tableData = stripProperties(['id'], tableData);
    tableData = _.filter(tableData, function (data) {
        return blackList.indexOf(data.key) === -1;
    });

    _.each(tableData, function (setting) {
        if (setting.key === 'activeTheme' && setting.value.indexOf('/')) {
            setting.value = setting.value.substring(setting.value.lastIndexOf('/') + 1);
        }
        setting.type = setting.type || 'custom';
    });

    ops.push(models.Settings.edit(tableData));
}

// No data needs modifying, we just import whatever tables are available
TempImporter.prototype.basicImport = function (data) {
    var ops = [],
        tableData = data.data;

    // Do any pre-processing of relationships (we can't depend on ids)
    if (tableData.posts_tags && tableData.posts && tableData.tags) {
        tableData = preProcessPostTags(tableData);
    }

    // Import things in the right order:
    if (tableData.tags && tableData.tags.length) {
        importTags(ops, tableData.tags);
    }

    if (tableData.posts && tableData.posts.length) {
        importPosts(ops, tableData.posts);
    }

    if (tableData.users && tableData.users.length) {
        importUsers(ops, tableData.users);
    }

    if (tableData.settings && tableData.settings.length) {
        importSettings(ops, tableData.settings);
    }

    /** do nothing with these tables, the data shouldn't have changed from the fixtures
     *   permissions
     *   roles
     *   permissions_roles
     *   permissions_users
     *   roles_users
     */

    return when.all(ops).then(function (results) {
        return when.resolve(results);
    }, function (err) {
        return when.reject("Error importing data: " + err.message || err, err.stack);
    });
};

module.exports = {
    TempImporter: TempImporter,
    importData: function (data) {
        return new TempImporter().importData(data);
    }
};
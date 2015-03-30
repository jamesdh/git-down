$(window).load(function() {

    var apiRoot = "https://api.github.com";
    var app = _.clone(Backbone.Events);
//    var globalEventSetup = function(child) {
//        child.prototype.initialize = _.wrap(child.prototype.initialize, function(init) {
//            this.initialize.apply(this, arguments);
//            this.on('all', function() {alert("BOOM")});
//        });
//        return child;
//    }
//    Backbone.Model.extend = _.compose(globalEventSetup, Backbone.Model.extend);

//################ MODELS ##############################################################################################
    var User = Backbone.Model.extend({
        idAttribute: "id",
        defaults: {
            username: null,
            password: null,
            login: null,
            name: null
        },
        url: apiRoot + "/user",
        initialize: function() {
            this.on("change:username change:password", this.authEncode, this);
            this.on("sync", this.publishAuth, this);
            var that = this;
            $(document).ajaxComplete(function(evt, xhr, settings) {
                that.extractRateLimit(xhr);
            })
        },
        authEncode: function() {
            var that = this;
            $.ajaxSetup({
                dataType: "jsonp",
                beforeSend: function(xhr) {
                    var b64auth = window.btoa(that.get("username") + ":" + that.get("password"));
                    xhr.setRequestHeader('Authorization', "Basic " + b64auth);
                }
            });
        },
        publishAuth: function() {
            if (this.has('login')) {
                app.trigger("user:auth", this);
            }
        },
        extractRateLimit: function(xhr) {
            var rateLimit = xhr.getResponseHeader("X-RateLimit-Remaining");
            this.set({rate_limit: rateLimit});
        }
    });

    var Repo = Backbone.Model.extend({
        idAttribute: "id",
        defaults: {
            name: null,
            url: null
        },
        parse: function(resp, options) {
            resp.created_at = new Date(resp.created_at);
            resp.updated_at = new Date(resp.updated_at);
            resp.pushed_at = new Date(resp.pushed_at);
            return resp;
        }
    });

    var Org = Backbone.Model.extend({
        idAttribute: "id",
        defaults: {
            id: null,
            login: null,
            repos: null //new Backbone.Collection.extend({model: Repo})()
        },
        initialize: function() {
            var orgRepos = new OrgRepos();
            this.set('repos', orgRepos);
            this.fetchOrgRepos();
        },
        fetchOrgRepos: function() {
            var orgRepos = this.get('repos');
            orgRepos.url = this.get('repos_url') + '?per_page=100';
            orgRepos.fetch({
                success: _.bind(function(collection) {
                    this.collection.trigger('change:org:repos', collection);
                }, this)
            })
        }
    });

//    TO BE CONTINUED...
//    var Milestone = Backbone.Model.extend({
//        idAttribute: "number",
//        defaults: {
//            title: null,
//            number: null
//        }
//    });
//
//    var Collaborator = Backbone.Model.extend({
//        idAttribute: "id",
//        defaults: {
//            login: null
//        }
//    });
//
//    var Label = Backbone.Model.extend({
//        idAttribute: "url",
//        defaults: {
//            name: null,
//            color: null
//        }
//    });

    var Issue = Backbone.Model.extend({
        idAttribute: "url",
        defaults: {
            html_url: null,
            number: null,
            title: null,
            assignee: null, // User
            labels: [], // Labels
            milestone: null, // Milestone
            createdAt: null, // "2011-04-22T13:33:48Z"
            closedAt: null
        }
    });

//################ COLLECTIONS #########################################################################################
    var Orgs = Backbone.Collection.extend({
        model: Org,
        url: apiRoot + "/user/orgs",
        initialize: function() {
            app.on("user:auth", this.fetchOrgs, this);
        },
        fetchOrgs: function() {
            this.fetch();
        }
    });

    var UserRepos = Backbone.Collection.extend({
        model: Repo,
        url: apiRoot + "/user/repos?per_page=100",
        initialize: function() {
            app.on("user:auth", this.fetchOnUser, this);
        },
        fetchOnUser: function(user) {
            this.fetch();
        }
    });

    var OrgRepos = Backbone.Collection.extend({
        model: Repo
    });

    var Repos = Backbone.Collection.extend({
        model: Repo,
        comparator: function(model) {
            return -model.get('updated_at').getTime();
        },
        initialize: function() {
            /**
             * Our Repos collection does a little magic to aggregate personal repositories with any organizational
             * repositories that they are also members of.
             */
            this.userRepos = new UserRepos();   // User has many Repo's (but personal only)
            this.orgs = new Orgs();             // User belongs to many Orgs -> each Org has many Repo's
            this.userRepos.on("sync", this.refreshUserRepos, this);
            this.orgs.on("change:org:repos", this.refreshOrgRepos, this);
        },
        refreshUserRepos: function() {
            this.userRepos.each(function(repo) {
                this.add(repo);
            }, this);
        },
        refreshOrgRepos: function(repos) {
            if (repos && !repos.isEmpty()) {
                repos.each(function(repo) {
                    this.add(repo);
                }, this);
            }
        }
    });

//    TO BE CONTINUED...
//    var Milestones = Backbone.Collection.extend({
//        model: Milestone,
//        url: "/repos/:owner/:repo/milestones"
//    });
//
//    var Collaborators = Backbone.Collection.extend({
//        model: Collaborator,
//        url: "/repos/:owner/:repo/collaborators"
//    });
//
//    var Labels = Backbone.Collection.extend({
//        model: Label,
//        url: "/repos/:owner/:repo/labels" // OR /repos/:owner/:repo/milestones/:number/labels
//    });

    var Issues = Backbone.Collection.extend({
        model: Issue,
        repo: null,
        opts: {
            'per_page': 100,
            state: 'open'
        },
        pagingUrl: null,
        url: function() {
            if (this.pagingUrl) {
                return this.pagingUrl;
            } else {
                var url = this.repo.get('issues_url').replace(/{.+}/, "");
                if (_.size(this.opts) > 0) {
                    url += '?';
                    url += _.map(this.opts,function(val, key) {
                        return key + '=' + val;
                    }).join('&');
                }
                return url;
            }
        },
        initialize: function() {
            this.on('sync', this.getPaginatedResults, this);
        },
        getPaginatedResults: function(model, resp, options) {
            var links = options.xhr.getResponseHeader("Link");
            if (links) {
                _.each(links.split(', '), function(link) {
                    var parts = link.split('; ');
                    if (parts[1] === 'rel="next"') {
                        this.pagingUrl = parts[0].replace('<', '').replace('>', '');
                        var that = this;
                        this.fetch({
                            update: true,
                            remove: false,
                            timeout: 15000,
                            error: function(errModel, errXhr, errOpts) {
                                var msg = 'Error when retrieving issues, <a id="retry" href="#">click here to retry</a>';
                                var errView = new ErrorView({model: msg});
                                $('#retry').one('click', function() {
                                    errView.close();
                                    errView = null;
                                    that.getPaginatedResults(model, resp, options);
                                });
                            }
                        });
                        return this.pagingUrl;
                    }
                }, this);
            } else {
                this.pagingUrl = null;
            }
        },
        setRepo: function(repo) {
            this.repo = repo;
            this.fetch();
        },
        /**
         * 'open' or 'closed'
         * Default: 'open'
         */
        setState: function(state) {
            this.opts.state = state;
            this.fetch();
        },
        /**
         * Integer Milestone number, 'none' for Issues with no Milestone, '*' for Issues with any Milestone.
         * Default: '*'
         */
        setMilestone: function(milestone) {
            this.opts.milestone = milestone;
        },
        /**
         * String User login, 'none' for Issues with no assigned User, '*' for Issues with any assigned User.
         * Default: '*'
         */
        setAssignee: function(assignee) {
            this.opts.assignee = assignee;
        }

    });

//################ VIEWS ###############################################################################################

    var MsgView = Backbone.View.extend({
        el: "#msg_view",
        events: {
            "click msg-close": "close"
        },
        initialize: function() {
            var template = _.template($("#msg_template").html())({error: this.model});
            this.$el.html(template);
        },
        close: function() {
            this.undelegateEvents();
            this.$el.removeData().unbind();
            this.$el.html("");
        }
    });

    var ErrorView = Backbone.View.extend({
        el: "#error_view",
        events: {
            "click error-close": "close"
        },
        initialize: function() {
            var template = _.template($("#error_template").html())({error: this.model});
            this.$el.html(template);
        },
        close: function() {
            this.undelegateEvents();
            this.$el.removeData().unbind();
            this.$el.html("");
        }
    });

    var RateView = Backbone.View.extend({
        el: "#rate_view",
        bindings: {
            '#rate': {
                observe: 'rate_limit',
                onGet: function(val) {
                    if (val) {
                        return val + "/5000";
                    } else {
                        return "";
                    }
                }
            }
        },
        initialize: function() {
            this.stickit();
        }
    });

    var UserView = Backbone.View.extend({
        el: "#user_view",
        events: {
            "click #login": "login",
            "submit form": "login",
            "click #logout": "logout"
        },
        bindings: {
            '#username': 'username',
            '#password': 'password'
        },
        initialize: function() {
            this.logout();
        },
        login: function() {
            var that = this;
            this.model.fetch({
                success: function(model, resp, options) {
                    $("#motd").fadeOut(500);
                    that.$el.fadeOut(500, function() {
                        var template = _.template($("#loggedin_template").html())(model.attributes);
                        that.$el.html(template);
                        that.$el.fadeIn(500);
                    });
                },
                error: function(model, xhr, options) {
                    that.logout();
                    var msg = xhr.status + " (" + xhr.statusText + ")";
                    if (xhr.responseText) {
                        msg += (" - " + JSON.parse(xhr.responseText).message);
                    }
                    new ErrorView({model: msg});
                }
            });
            return false; // prevent browser default action (reloading) from form submit
        },
        logout: function() {
            this.model.clear();
            var template = _.template($("#userlogin_template").html())({});
            this.$el.html(template);
            $("#motd").fadeIn(0);
            $("#username").focus();
            this.stickit();
        }
    });

    var ReposView = Backbone.View.extend({
        el: "#repos_view",
        bindings: {
            '#repos_select': {
                observe: 'repo',
                selectOptions: {
                    collection: 'this.collection',
                    labelPath: 'name',
                    valuePath: 'id'
                }
            }
        },
        initialize: function() {
            this.model = new (Backbone.Model)({repo: null});
            this.model.on('change:repo', function(model) {
                this.trigger('selected', this.collection.get(model.get('repo')));
            }, this);
            this.collection.on("add remove reset sync", this.render, this);
        },
        render: function() {
            this.stickit();
        }
    });

    var StatusView = Backbone.View.extend({
        el: "#status_view",
        bindings: {
            '#status_select': {
                observe: 'status',
                selectOptions: {
                    collection: function() {
                        return ['open', 'closed'];
                    }
                }
            }
        },
        initialize: function() {
            this.model = new (Backbone.Model)({status: 'open'});
            this.model.on('change:status', function(model) {
                this.trigger('selected', model.get('status'));
            }, this);
            this.render();
        },
        render: function() {
            this.stickit();
        }
    });

//    var FromView = Backbone.View.extend({
//        el: "#from_view",
//        initialize: function() {
//            this.$el.datepicker();
//        }
//    });

    var IssuesView = Backbone.View.extend({
        el: "#issues_view tbody",
        initialize: function() {
            this.collection.on('sync', this.render, this);
        },
        render: function() {
            var rows = '';
            this.collection.each(function(issue) {
                rows += _.template($("#issue_template").html())(issue.attributes);
            }, this);
            this.$el.html(rows);
        }
    });

    var user = new User(),
        repos = new Repos(),
        issues = new Issues(),
        userView = new UserView({model: user}),
        rateView = new RateView({model: user}),
        reposView = new ReposView({collection: repos}),
        statusView = new StatusView(),
        issuesView = new IssuesView({collection: issues});

    issues.listenTo(statusView, 'selected', issues.setState);
    issues.listenTo(reposView, 'selected', issues.setRepo);

    
    Downloadify.create('downloadify',{
        filename: function(){
            return "issues.csv";
        },
        data: function(){
            var data = "";
            var headers = [];
            $('#issues_table > thead > tr > th').each(function(index, thEl) {
                headers.push($(thEl).text());
            });
            data += (headers.join(',') + '\n');
            $('#issues_table > tbody > tr').each(function(index, trEl) {
                var row = [];
                $(trEl).find('td').each(function(index, tdEl) {
                    var td = $(tdEl).text();
                    if(td.indexOf(',')) {
                        td = "\"" + td.replace(/"/g, "'") + "\"";
                    }
                    row.push(td);
                });
                data += (row.join(',') + '\n');
            });
            return data;
        },
        onComplete: function(){ new MsgView({model: 'Your file has been saved!'}); },
        onCancel: function(){ new MsgView({model: 'You have cancelled the saving of this file.'}); },
        onError: function(){ new MsgView({model: 'There was an error when attempting to save the file.'}); },
        swf: 'swf/downloadify.swf',
        downloadImage: 'img/download.png',
        width: 100,
        height: 30,
        transparent: true,
        append: false
    });

});


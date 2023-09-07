# Contribute to the Navplace Viewer

## ❤️ Thank You
Thank you for considering a contribution to this viewer!  The `main` branch is protected and you cannot push to it.  Please make a new branch, and when you are a finished open a pull request targeting the `main` branch.  The pull request will be reviewed and we will get back to you.

## Ready to Install It And Run It!

<b><u>RUN THE APP IN A WEB SERVER CONTAINER</u></b>

If you want to contribute, it is imortant you are able to deploy the code and run locally.  To do so, it is best you use some kind of web container such like [Docker](https://docs.docker.com/get-started/) or [Tomcat](https://tomcat.apache.org/).  You can use any web server container you prefer.  

You want a web server container because the viewer's main usage requires asking the internet for resources by their URI, like https://store.rerum.io/v1/id/11111.  Opening the viewer through your filepath as opposed to a web server container will not function as you expect, browsers do not like this scenario.  Feel free to try.

## Ready to Code!

You may contribute to the code directly through its repository or by making a fork in your own repository space. Please make a new branch, and when you are a finished open a pull request targeting the `main` branch.  The pull request will be reviewed.

Make sure Git is installed on your machine.  For download and installation instruction, [head to the Git guide](https://git-scm.com/downloads).  Note this can also be achieved by install [GitHub for Desktop](https://desktop.github.com/).  

The following is a git shell example for installing the app on your local machine.

```
cd /web_container/
git clone https://github.com/CenterForDigitalHumanities/navplace-viewer.git navplace-viewer
```

That's all you need!  Now start up your web server.  If you used the example above access the viewer at http://localhost/navplace-viewer  

Create your a file named `.env` in the root folder.  In the above example, the root is `/code_folder/geolocator`.  `/code_folder/geolocator/.env` looks like this:

## Ready to code!

First, make a new branch through the GitHub Interface or through your shell.  Make sure you 'checkout' that branch.

```
cd /web_container/navplace-viewer
git checkout my_new_branch
```

Now you can make code changes and see them in real time.  When you are finished with the commits to your new branch, open a Pull Request that targets the `main` branch at [https://github.com/CenterForDigitalHumanities/navplace-viewer/tree/main/] (https://github.com/CenterForDigitalHumanities/navplace-viewer/tree/main/).



